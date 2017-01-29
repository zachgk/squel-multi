# squel-multi

A wrapper over squel for handling multiple similar database designs.
Given a mapping from a universal naming scheme to a database, it allows you to write SQL queries using a chainable interface for the universal scheme and then intelligently map it to any of the mapped schemes while automatically handling joining and grouping when possible.

## Configuration

Use `squel-multi.setComponents(componentObject)` to specify a components object and `squel-multi.addMap(mapName, mapObject)` to specify a map.

## Usage

A builder can be obtained by calling `squel-multi.builder()`.

The following chainable functions can be used:

- `.field(name, alias, arg)`
- `.set(name, value)`
- `.setFieldsRows(rows, fields)`
- `.group(name)`
- `.where(name, arg)`
- `.whereNeq(name, val)`
- `.whereEq(name, val)`
- `.whereSubstr(name, val)`
- `.whereNotNull(name)`
- `.whereIn(name, vals)`
- `.union(other)`
- `.order(name, arg, dir)`
- `.having(name)`
- `.top(count)`
- `.fieldDirect(name, alias)`
- `.allFields()`
- `.from(name)`
- `.table(name)`
- `.join(name)`
- `.left_join(name)`
- `.component(name)`
- `.log()`

To use a type of query besides SELECT, call:

- `.remove()`
- `.insert()`
- `.update()`

To get the finished query from a builder object, call `.build(dbMapName, dbName, flavour, shouldReturnSquelObjectInsteadOfString)`

## Components

`componentObject[componentName](dbMapName)` should return a list of field names.
It can be used as either a macro to add multiple fields at once or when the fields depend on the map used.

## Maps

A map object describes a mapping from the names used with squel-multi to the actual table and field names in a particular database you are working with.  It has several subobjects:

### tables object

`mapObject['tables'][universalTableName] = [actualTableName, alias]` - this should be the most common usage

`mapObject['tables'][universalTableName] = [actualTableName, defaultTableAlias, ...tableDependencies]` - Add tables that must be joined before this table should be joined

`mapObject['tables'][universalTableName] = [function(dbName), alias]` - The function should return a string containing the table name or definition.  Can be used for subqueries.

`mapObject['tables'][universalTableName] = function(squelMultiBuilder)` - this can be used to add multiple tables or unions at once and treat it as one combined table

### tableJoins array

`mapObject['tableJoins'][] = fieldName` - If tables that are being returned have this field name in them, they will be joined by it

`mapObject['tableJoins'][] = {tableName: 'alias.actualFieldName', tableName: ['alias.actualFieldName']}` - If multiple tables in this object are being returned, they are all joined by the fields in this map.  If a fields array is specified, the join is an OR of those fields.

### fields object

`mapObject['fields'][fieldName] = [['actualFieldName', ...tables], ...tableDependencies, optionsObject?]` - This form should be used if all the tables use the same field name.  Specify the field name and then the list of tables that contain this field

`mapObject['fields'][fieldName] = [{tableName: 'actualFieldName'}, ...tableDependencies, optionsObject?]` - This form should be used if not all tables containing this field use the same field name

`mapObject['fields'][fieldName] = ['alias.actualFieldName', ...tableDependencies, optionsObject?]` - This form should be used if only one table has this field.

Table dependencies are which tables need to be selected or joined to obtain this field.  If there is no ambiguity, tables will be joined automatically.  No tables are joined if any table containing this field is already added.

The optional optionsObject can specify some additional properties of a field.  The main property is 'group'.  When there is a grouping, this specifies what should happen to the field.  The default behavior is to sum the field.  The other options are:

- 'auto' - Automatically group on this field too
- 'avg' - Return the average of the field instead of the sum
- 'none' - Do not alter the field

The optionsObject can also be given `type: varchar` to ensure it is a string for insertions/updates.

When a field is returned, it is by default aliased to the universal name of the field.  Sometimes it is useful to have multiple variations of the field which can be specified with a prefix seperated by an underscore.  When it is returned, the prefix is not part of the alias.

## filters object

`mapObject['filters'][filterName] = filter`

`mapObject['filters'][filterName] = [filter]`

`mapObject['filters'][filterName] = {filters: filters, deps: [tableDependencies]}`

The filter should be used when a WHERE clause is more complicated than can be specified with the main functions such as whereEq, whereNotNull, or whereIn.  There are two formats for a filter.  The first is a string specifying the clause.  The second is an array where the first part is a string that contains '?' instead of arguments and the later elements of the array correspond to the arguments.
