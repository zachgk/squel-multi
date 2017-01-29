'use strict';

var squel = require('squel');
var _ = require('lodash');

var mainComponents = {}
var maps = {}
exports.setComponents = function(comps) {
  mainComponents = comps;
}

exports.addMap(name, map) {
  maps[name] = map;
}

exports.builder = function() {
  var self = {
    mode: 'select',
    props: [],
    groups: [],
    filters: [],
    tables: [],
    unions: [],
    havingList: []
  };

  self.getTableAlias = function(table) {
    if(!table) table = self.tables[0];
    return _.get(maps, [self.dbModel, 'tables', table, 1]);
  };

  self.addDependency = function(deps) {
    if(!deps) return self;
    for(var i=0; i<deps.length; i++) {
      var dep = deps[i];
      if(_.isString(dep)) dep = ['left_join', dep];
      if(self.tables.indexOf(dep[1]) == -1) {
        if(self.tables.length == 0) {
          self.from(dep[1]);
        } else {
          self[dep[0]](dep[1]);
        }
      }
    }
    return self;
  }

  function getTable(name) {
    var table = {};
    //table.deps = _.cloneDeep(maps[self.dbModel]['tables'][name]);
    table.deps = maps[self.dbModel]['tables'][name];
    if(_.isFunction(table.deps)) {
      table.deps(self);
      return;
    } else if(!_.isArray(table.deps)) {
      var t = table.deps.table;
      self.tables.push(t);
      return getTable(t);
    } else {
      table.deps = _.cloneDeep(table.deps);
    }
    var nameF = table.deps.shift();
    table.alias = table.deps.shift();
    if(_.isString(nameF)) {
      table.name = function(dbName) {
        return '[' + dbName + '].[dbo].[' + nameF + ']';
      };
    } else {
      table.name = nameF;
    }
    table.name = table.name(self.dbName, self);
    _.each(table.deps, function(dep) {
      if(self.tables.indexOf(dep) == -1) {
        self.tables.splice(self.tables.indexOf(name), 0, dep);
        var depT = getTable(dep);
        self.squelQuery.left_join(depT.all);
      }
    });
    table.all = table.name + " AS " + table.alias;
    table.joins = false;
    var prevTables = _.take(self.tables, self.tables.indexOf(name));
    if(prevTables.length > 0) {
      var joins = maps[self.dbModel]['tableJoins'];
      _.each(joins, function(join) {
        if(_.isString(join)) {
          join = _.cloneDeep(maps[self.dbModel]['fields'][join][0]);
          if(_.isArray(join)) {
            var base = join.shift();
            join = _.chain(join)
              .map(function(l) {
                return [l, self.getTableAlias(l) + "." + base];
              })
              .fromPairs()
              .value();
          }
        }
        var ints = _.intersection(_.keys(join), prevTables);
        if(join[name] && ints.length > 0) {
          if(!table.joins) {
            table.joins = true;
            table.all += " ON ";
            var jdeps = _.drop(maps[self.dbModel]['tables'][ints[0]], 2);
            if(jdeps.indexOf(name) > -1) table.joins = false;
          } else {
            table.all += " AND ";
          }
          var joinEqs = [];
          var a = join[name];
          var b = join[ints[0]];
          if(!_.isArray(a)) a = [a];
          if(!_.isArray(b)) b = [b];
          _.each(a, function(x) {
            _.each(b, function(y) {
              joinEqs.push(x + "=" + y);
            });
          });
          table.all += "(" + joinEqs.join(" OR ") + ")";
        }
      });
    }
    return table;
  }

  function getField(name, alias, arg) {
    var field = {};
    field.deps = _.cloneDeep(maps[self.dbModel]['fields'][name]);
    if(!field.deps) throw new Error('Unknown field: ' + name);
    field.name = field.deps.shift();
    if(_.isPlainObject(_.last(field.deps))) {
      var fObj = field.deps.pop();
      _.assign(field, fObj);
    }
    if(_.isArray(field.name)) {
      var base = field.name.shift();
      field.usedTable = _.intersection(field.name, self.tables)[0];
      var tableAlias = self.getTableAlias(field.usedTable);
      if(!tableAlias) throw new Error("Could not determine table for field " + name);
      field.name = tableAlias + "." + base;
    } else if(_.isFunction(field.name)) {
    } else if(_.isObject(field.name)) {
      field.usedTable = _.intersection(_.keys(field.name), self.tables)[0];
      field.name = field.name[field.usedTable];
    }
    field.nameEnd = name.split('_').pop();
    field.alias = alias ? alias : field.nameEnd;
    if(self.mode != 'select') {
      if(_.isString(field.name)) field.name = field.name.replace(self.getTableAlias() + '.', '');
    }

    if(_.isFunction(field.name)) {
      field.auto = field.name(arg, self);
    } else if(self.groups.length > 0 && self.groups.indexOf(field.nameEnd) == -1) {
      if(_.isPlainObject(field.group)) field.group = field.group[field.usedTable];
      switch(field.group) {
        case 'auto':
          _group(name);
          field.auto = field.name;
          break;
        case 'avg':
          field.auto = "AVG(" + field.name + ")";
          break;
        case 'none':
          field.auto = field.name;
          break;
        default:
          field.auto = "SUM(" + field.name + ")";
      }
    } else {
      field.auto = field.name;
    }

    self.addDependency(field.deps);
    return field;
  }

  self.field = function(name, alias, arg) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.field(name, alias, arg); });
      var field = getField(name, alias, arg);
      var call = (self.mode == 'select' ? 'field' : 'output');
      query[call](field.auto, field.alias);
    });
    return self;
  };

  self.set = function(name, value) {
    self.props.push(function(query) {
      var field = getField(name);
      query.set(field.name, value);
    });
    return self;
  };

  self.setFieldsRows = function(rows, fields) {
    self.props.push(function(query) {
      var data = _.map(rows, function(row) {
        if(fields) {
          row = _.pick(row, fields);
          _.each(fields, function(f) {
            if(_.isUndefined(row[f])) row[f] = null;
          });
        }
        var obj = {};
        _.each(row, function(value, name) {
          var field = getField(name);
          if(field.type && !_.isNull(value)) {
            if(field.type == 'varchar') value = value.toString();
          }
          obj[field.name] = value;
        });
        return obj;
      });
      query.setFieldsRows(data);
    });
    return self;
  };

  function _group(name) {
    var nameEnd = name.split('_').pop();
    self.groups.push(nameEnd);
    self.props.push(function(query) {
      var field = getField(name);
      if(_.isString(field.name)) query.group(field.name);
    });
    return self;
  }

  self.group = function(name) {
    var nameEnd = name.split('_').pop();
    self.groups.push(nameEnd);
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.group(name); });
      var field = getField(name);
      if(_.isString(field.name)) query.group(field.name);
    });
    return self;
  };

  self.where = function(name, arg) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.where(name, arg); });
      var fs = maps[self.dbModel]['filters'][name];
      if(_.isArray(fs) || _.isFunction(fs) || !_.isObject(fs)) fs = {filters: fs};
      if(!_.isArray(fs.filters)) fs.filters = [fs.filters];
      self.addDependency(fs.deps);
      self.filters.push(name);
      _.each(fs.filters, function(filter) {
        if(_.isString(filter)) query.where(filter);
        else query.where.apply(query, filter(arg, self));
      });
    });
    return self;
  };

  self.whereNeq = function(name, val) {
    if(_.isUndefined(val)) return self;
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.whereNeq(name, val); });
      var field = getField(name);
      query.where(field.name + ' <> ?', val);
    });
    return self;
  };

  self.whereEq = function(name, val) {
    if(!val) return self;
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.whereEq(name, val); });
      var field = getField(name);
      query.where(field.name + ' = ?', val);
    });
    return self;
  };

  self.whereSubstr = function(name, val) {
    if(!val) return self;
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.whereSubstr(name, val); });
      var field = getField(name);
      query.where(field.name + ' LIKE ?', '%' + val + '%');
    });
    return self;
  };

  self.whereNotNull = function(name) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.whereNotNull(name); });
      var field = getField(name);
      query.where(field.name + ' IS NOT NULL');
    });
    return self;
  };

  self.whereIn = function(name, vals) {
    if(_.isUndefined(vals)) return self;
    if(vals.length == 0) vals = [null];
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.whereIn(name, vals); });
      var field = getField(name);
      query.where(field.name + ' IN ?', vals);
    });
    return self;
  };

  self.union = function(other) {
    self.unions.push(other);
    return self;
  };

  self.order = function(name, arg, dir) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.order(name, arg, dir); });
      var field = getField(name, undefined, arg);
      if(field.auto.match(/^'[a-zA-Z1-9 ]*'$/g) || field.auto.match(/^[-]?[1-9]+$/g)) return;
      query.order(field.auto, dir);
    });
    return self;
  };

  self.having = function(name) {
    self.props.push(function(query, dbModel) {
      _.each(self.unions, function(u) { u.having(name); });
      self.havingList.push(maps[self.dbModel]['filters'][name]);
    });
    return self;
  };

  self.top = function(count) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.top(count); });
      if(!_.isString(count)) count = count.toString();
      query.top(count);
    });
    return self;
  };

  self.fieldDirect = function(name, alias) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.fieldDirect(name, alias); });
      query.field(name, alias);
    });
    return self;
  };

  self.allFields = function() {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.allFields(); });
      query.field('*');
    });
    return self;
  };

  self.from = function(name) {
    if(self.tables.indexOf(name) >= 0) return self;
    self.tables.push(name);
    self.props.push(function(query) {
      var table = getTable(name);
      if(!table) return;
      query.from(table.all);
    });
    return self;
  };

  self.table = function(name) {
    if(self.tables.indexOf(name) >= 0) return self;
    self.tables.push(name);
    self.props.push(function(query) {
      var table = getTable(name);
      if(!table) return;
      if(self.mode == 'insert') query.into(table.name);
      else if(self.mode == 'update') query.table(table.name);
    });
    return self;
  };

  self.join = function(name) {
    if(self.tables.indexOf(name) >= 0) return self;
    self.tables.push(name);
    self.props.push(function(query) {
      var table = getTable(name);
      if(!table) return;
      query.join(table.all);
    });
    return self;
  };

  self.left_join = function(name) {
    if(self.tables.indexOf(name) >= 0) return self;
    self.tables.push(name);
    self.props.push(function(query) {
      var table = getTable(name);
      if(!table) return;
      query.left_join(table.all);
    });
    return self;
  };

  self.component = function(name) {
    self.props.push(function(query) {
      _.each(self.unions, function(u) { u.component(name); });
      var comps = mainComponents[name](self.dbModel);
      if(!_.isArray(comps)) comps = [comps];
      for(var i=0; i<comps.length; i++) {
        self.field(comps[i]);
      }
    });
    return self;
  };

  self.remove = function() {
    self.mode = 'remove';
    return self;
  };

  self.insert = function() {
    self.mode = 'insert';
    return self;
  };

  self.update = function() {
    self.mode = 'update';
    return self;
  };

  self.log = function() {
    self.doLog = true;
    return self;
  };

  self.build = function(dbModel, dbName, flavour, getSquel) {
    self.dbModel = dbModel;
    self.dbName = dbName;
    var query;
    if(self.mode == 'select') query = squel.useFlavour(flavour).select();
    else if(self.mode == 'remove') query = squel.useFlavour(flavour).remove();
    else if(self.mode == 'insert') query = squel.useFlavour(flavour).insert();
    else if(self.mode == 'update') query = squel.useFlavour(flavour).update();

    self.squelQuery = query;

    for(var i=0; i<self.props.length; i++) {
      self.props[i].apply(self, [query]);
    }

    _.each(self.unions, function(u) {
      var ub = u.build(dbModel, dbName);
      query.union('(' + ub + ')');
    });

    var s = query.toString();
    self.havingList = [];
    for(var i=0; i<self.havingList.length; i++) {
      s+= ' HAVING ' + self.havingList[i];
    }
    if(self.mode == 'remove') s = s.replace('DELETE', 'DELETE ' + self.getTableAlias());
    if(self.mode == 'insert' || self.mode == 'update') s = s.replace(' AS ' + self.getTableAlias(), '');
    if(self.doLog) console.log(s);
    return getSquel ? query : s;
  };

  return self;
};
