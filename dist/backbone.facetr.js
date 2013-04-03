// Backbone.Facetr 0.1.0 
// Copyright (c)2012-2013 Arillo GmbH 
// Author Francesco Macri 
// Distributed under MIT license 
// https://github.com/arillo/Backbone.Facetr 
(function (root, factory) {
	if (typeof exports === 'object') {

		var underscore = require('underscore');
		var backbone = require('backbone');

		module.exports = factory(underscore, backbone);

	} else if (typeof define === 'function' && define.amd) {

		define(['underscore', 'backbone'], factory);

	} else {

		factory(root, _, Backbone);
	
	}
}(this, function (window, _, Backbone, undefined) {
  	"use strict";

  	// create Facetr function as Backbone property
  	// create a global reference of Facetr for convenience
  	// when adding a collection, an id can be associated with it
  	// future call to Facetr can use either the Backbone.Collection instance
  	// as paramter or the given id to retrieve the FacetCollection
  	Backbone.Facetr = function(collection, id) {
  		if(collection instanceof Backbone.Collection) {
    		return _begetCollection(collection, id);
		} 
			
		return _getCollection(collection);
	};
	
	Backbone.Facetr.VERSION = '0.0.1';
	
	// facet collections cache
	var _collections = {};
		
	// get a collection from the _collections hash based on the id
	// passed as argument at the first Facetr invokation
	var _getCollection = function(id) {
		var coll = _collections[id];
		if(coll) {
			return coll;
		}
		
		return undefined;
	};
	
	// checks if the given collection exists in the cache, if not creates a new FacetCollection with the given collection data
	// adds a facetrid attribute to the original collection for fast lookup
	var _begetCollection = function(collection, id) {
		var colid = collection.facetrid || id || 'fctr'+new Date().getTime()+Math.floor((Math.random()*99)+1),
			coll = _getCollection(colid);
		if(coll) {
			return coll;
		} else {
			collection.facetrid = colid;
			return _collections[colid] = new FacetCollection(collection);
		}	
	};
		
	var _getValue = function(model, attr) {
		var value, tokens = attr.split('.'), len = tokens.length, i = 0;
		// iterate over possible properties of properties in order to allow Property.Property notation
		// if tokens length is 1, just return the Backbone.Model property value if any is found
		do {
			value = (value instanceof Array) ? value : (value && ((value.get && value.get(tokens[i])) || value[tokens[i]])) || (model && model instanceof Backbone.Model && model.get(tokens[i])) || undefined;
			i += 1; 
		} while(i < len);
		 
		return value;
	};
	// Facet class
	var	Facet = function(facetName, modelsMap, vent, extOperator) {
	    // give facet instances ability to handle Backbone Events
	    _.extend(this, Backbone.Events);
	
	    // init local variables with default values
	    var _self 			= this,
	        _name 			= facetName, 	// corresponds to the model attribute name or 'Property.Property1.PropertyN' for deeper relations
			_label 			= facetName, 	// a human readable label
			_sortBy 		= 'value',	 	// determines if facet values are sorted by 'value' or 'count'
			_sortDirection 	= 'asc',	 	// determines facet values sort direction
			_values 		= [],		 	// facet values computed from collection models (Ex.: { value: 'Title', count: 2 })
			_activeValues	= [],			// currently selected facet values
			_activeModels 	= [],			// active models according to currently selected values
			_valModelMap	= {},			// a map of values to model, used for fast filtering. it exploits the unique 'cid' given to each Backbone.Model 
			_extOperator    = extOperator,
			_operator		= 'or',			// default internal operator
			_selected		= false,		// a flag which is set to true if any of the facet values is selected,
			_customData		= {},			// a map of custom data which can be added to the facet
			
		// creates a facetValue with count 1 or increases the count by 1 of an existing faceValue in values 
		_begetFacetValue = function(facetValues, value, cid) {
			var val = value || 'undefined', isObj = false;
			
			// TODO - find better solution, this is just a quick fix
			// Problem: case of property consisting of Array of Objects was overlooked
			// in original design of dot notation
			if(val instanceof Object) {
				var attr = _name.split('.')[1];
				val = attr && (val instanceof Backbone.Model && val.get(attr) || val[attr]) || 'undefined';
				isObj = true; 
			}
			
			var facetValue = _.find(facetValues, function(v) {
				return v.value === val;
			});
			
			if(facetValue) {
				facetValue.count = facetValue.count + 1;
				facetValue.activeCount = facetValue.activeCount + 1;
			} else {
				// use sort index to get index where value should be put in order to keep values sorted
				var sortedIndex = _.sortedIndex(_.pluck(_values, 'value'), val);
				
				// note that at init values are sorted by the default sort property and direction, ie. 'value' and 'asc'
				_values.splice(sortedIndex, 0, {
					value		: val,
					count		: 1,
					activeCount	: 1,
					active 		: false
				});
				
				// create an entry in the value to model map for the given value
				_valModelMap[val] = [];
			}
			
			if(isObj) {
				_valModelMap[val].push(cid);	
			}
		},
		_parseModel = function(model, facetName) {
			var value = _getValue(model, _name);
			
			if(value) {
				if(value instanceof Array) {
					_.each(value, function(v) {
						_begetFacetValue(_values, v, model.cid);
						// push the model.cid in the current value entry of the value to model map
						if(_valModelMap[v])
							_valModelMap[v].push(model.cid);
					});
				} else {
					if(typeof value === 'object') {
						_self.remove();
						throw new Error('Model property can only be a value (string,number) or Array of values, not an object');
					}
					
					_begetFacetValue(_values, value);
					_valModelMap[value].push(model.cid);			
				}
			}
		},
		// reads model.get(facetName) from the models in the collection and populates the array of values
		_computeValues = function(modelsMap) {
			_(modelsMap).each(function(model) {
				_parseModel(model);
			});
		},
		// sort method sorts the facet values according to the given sortBy and sortDirection
		_sort = function() {
			_values.sort(function(v1,v2) {
				if(_sortBy === 'value') {
					// note that facet values are always unique, so v1.value === v2.value is never true
					return (_sortDirection === 'asc') ? ((v1.value > v2.value)-(v1.value < v2.value)) : ((v1.value < v2.value)-(v1.value > v2.value)); 
				} else if(_sortBy === 'activeCount') {
					if(_sortDirection === 'asc')  {
						if(v1.activeCount < v2.activeCount) {
							return -1;	
						} else if(v1.activeCount > v2.activeCount) {
							return 1;
						} else {
							// if both facet values have same activeCount, sort by value
							return ((v1.value > v2.value)-(v1.value < v2.value));
						}
					} else {
						if(v1.activeCount < v2.activeCount) {
							return 1;		
						} else if(v1.activeCount > v2.activeCount) {
							return -1;
						} else {
							return ((v1.value < v2.value)-(v1.value > v2.value));
						}
					}
				} else {
					if(_sortDirection === 'asc')  {
						if(v1.count < v2.count) {
							return -1;	
						} else if(v1.count > v2.count) {
							return 1;
						} else {
							// if both facet values have same count, sort by value
							return ((v1.value > v2.value)-(v1.value < v2.value));
						}
					} else {
						if(v1.count < v2.count) {
							return 1;		
						} else if(v1.count > v2.count) {
							return -1;
						} else {
							return ((v1.value < v2.value)-(v1.value > v2.value));
						}
					}
				}
			});
		},
		// checks if any of the facet values is currently selected by testing if _activeValues is empty
		_isSelected = function() {
			return _activeValues.length !== 0;
		},
		// compute active facet values count
		_computeActiveValuesCount = function(filteredModels) {			
			for(var i = 0, len = _values.length; i < len; i += 1) {
				// if(filteredModels.length !== 0) {
				// compute intersection of value models and filtered models and store the length
				var intersectLen = _.intersection(_valModelMap[_values[i].value], filteredModels).length;
	
				// if any filtered model is in the value models
				if(intersectLen !== 0) {
					// value active count is the length of the intersection
					_values[i].activeCount = intersectLen;
				} else {
					// if no values are selected for the facet and the value is not in any of the filtered models
					// then the value active count is equal 0
					_values[i].activeCount = 0;
				}
			}			
		},
		// invoked whenever a Backbone collection is reset
		_resetFacet = function(modelsMap) {
			// empty current select values and copy them in a new array
			var activeValCopy = _activeValues.splice(0, _activeValues.length);
			
			// empty _values and_activeModels arrays
			_values.splice(0, _values.length);
			_activeModels.splice(0, _activeModels.length);
			
			// reset _valModelMap
			_valModelMap = {};
			
			// recompute values
			_computeValues(modelsMap);
	
			// readd each value which was selected before the reset to the facet
			for(var i = 0, len = activeValCopy.length; i < len; i += 1) {
				_self.value(activeValCopy[i]);
			}
		},
		// invoked whenever a new Model instance is added to the Backbone collection
		_addModel = function(model) {
			// parse the new model properties to update _values and other local data structures
			_parseModel(model);
			
			// reapply active values to account the new model
			for(var i = 0, len = _activeValues.length; i < len; i += 1) {
				_self.value(_activeValues[i]);
			}
		},
		// invoked whenever a model is removed to the Backbone collection
		_removeModel = function(model) {
			var cid = model.cid, 
				modelJSON = model.toJSON(), 
				index, 
				value, 
			    decrementValue = function(value) {
			    	index = _values.length-1;
					while(index !== -1) {
						var v = _values[index], found = false;
						
						if(v.value === value) {
							// update count and activeCount
							v.count -= 1;
							v.activeCount -= 1;
							
							// remove value if count is 0 meaning no models have this value anymore
							if(v.count === 0) {
								_values.splice(index,1);
								// remove the value from active values
								var j = _.indexOf(_activeValues,v.value);
								if(j !== -1) {
									_activeValues.splice(j,1);
									
									// check if facet is still selected after removing the value
									_selected = _isSelected();
								}
							}
							
							// stop the loop as the value was already found
							break;
						}
						
						index -= 1;
					}
			    };
	
			// remove model cid from val to model map
			for(var val in _valModelMap) {
				if(_valModelMap.hasOwnProperty(val)) {
					index = _.indexOf(_valModelMap[val], cid);
					if(index !== -1) {
						_valModelMap[val].splice(index, 1);
					}
				}
			}
			
			value = _getValue(model, _name);
			
			// decrement count and active count for the value
			if(value) {
				if(value instanceof Array) {
					for(var i = 0, len = value.length; i < len; i++) {
						decrementValue(value[i]);
					}
				} else {
					decrementValue(value);
				}
			}
			
			// remove model from active models
			index = _.indexOf(_activeModels, cid);
			if(index !== -1) {
				_activeModels.splice(index,1);
			}
		},
		// invoked whenever a model is changed
		_changeModel = function(model) {
			var prev, prevVal;
			// check if the value changed was a value of this facet, if not nothing needs to be done
			if(_getValue(new Backbone.Model(model.changedAttributes()), _name)) {
				// create a clone of model previous state
				prev = new Backbone.Model(model.previousAttributes());
				prevVal = _getValue(prev, _name);
				prev.cid = model.cid;
				// remove the old state of the model
				_removeModel(prev);
				// add the new state of the model
				_addModel(model);
			}
		},
		// a FacetExp object is returned by the Facet.value method to enable logical filters chaining
		FacetExp = function() {
			// and method
			this.and = function(facetValue) {
				_operator = 'and';
				_self.value(facetValue);
				
				return this;	
			};
			
			// or method
			this.or = function(facetValue) {
				_operator = 'or';
				_self.value(facetValue);
				return this;
			};
		};
		
		// setters return always this Facet instance for method chaining
		this.label 			= function(label) { _label = label; return this; }; 				// sets the label to the given string
		this.asc 			= function() { _sortDirection = 'asc'; _sort(); return this; }; 	// sets sort direction to asc
		this.desc 			= function() { _sortDirection = 'desc'; _sort(); return this; };	// sets sort direction to desc
		this.sortByValue 	= function() { _sortBy = 'value'; _sort(); return this; };			// sets sortBy facet  name
		this.sortByCount 	= function() { _sortBy = 'count'; _sort(); return this; };			// sets sortBy facet value count
		this.sortByActiveCount = function() { _sortBy = 'activeCount'; _sort(); return this; };
		
		// returns a JSON object containing this Facet instance info and values
		this.toJSON = function() {
			return {
				'data' : {
					'name' : _name,
					'label' : _label,
					'extOperator' : _extOperator,
					'intOperator' : _operator,
					'sort' : {
						'by' : _sortBy,
						'direction' : _sortDirection
					},
					'selected' : _selected,
					'customData' : _customData
				},
				'values' : _values
			};
		};
		
		// removes this facet from the FacetCollection, by delegating removal operations to the FacetCollection instance
		this.remove = function() {
			// detach event listeners from collection vent object
			vent.off('resetCollection', _computeActiveValuesCount);
		
			vent.off('resetOrigCollection', _resetFacet);
			
			vent.off('addModel', _addModel);
			vent.off('removeModel', _removeModel);
			vent.off('changeModel', _changeModel);
		
			// trigger an event to notify the FacetCollection instance of the change
			// which will then remove the facet from the facets object
			vent.trigger('removeFacet', _name); 
		};
		
		// adds the given value
		// returns a FacetExp object, which can be used to chain facet value selectors with
		// logical operators
		this.value = function(facetValue, operator) {
			if(operator) {
				_operator = operator;
			}
			
			// get the index of the value in the _values array
			var valueIndex = _.chain(_values).pluck('value').indexOf(facetValue).value(), 
				value;
			
			// continue only if value exists, otherwise throw an error	
			if(valueIndex !== -1) {
				value = _values[valueIndex];
				
				// set the facet value to active only if it is not already so 
				if(!value.active) {
					value.active = true;
					_activeValues.push(value.value);
				}
				
				// depending on the operator
				if(_operator === 'or' || _activeModels.length === 0) {
					// compute active models as the union of existing active models and facet value models
					_activeModels = _.union(_activeModels, _valModelMap[facetValue]);	
				} else {
					// or compute the intersection of the two sets
					_activeModels = _.intersection(_activeModels, _valModelMap[facetValue]);	
				}
				
				// update is local _selected value
				_selected = _isSelected();
				
				// trigger a value event to notify the FacetCollection about the change
				vent.trigger('value', _name, facetValue, _activeModels);
				
				// return a FacetExp object to allow Facetr expression chain
				return new FacetExp(this, _operator);
			} else {
				throw new Error('Value "'+facetValue+'" does not exist for facet '+_name);
			}
		};
		
		// removes the given value
		this.removeValue = function(facetValue) {
			var valueIndex = _.chain(_values).pluck('value').indexOf(facetValue).value(),
				value, modelsToRemove;
			
			// check if was exists	
			if(valueIndex !== -1) {
				value = _values[valueIndex]; 
				
				// if value is active
				if(value.active) {
					// set value to inactive
					value.active = false;
					// remove value from active values array
					_activeValues.splice(_.indexOf(_activeValues, value.value), 1);
					
					// compute models to remove from the active models due to facet value deselection
					// need to filter out models which are included in active models due to another
					// facet value being selected (thing that can happen on model properties which are of type Array)
					modelsToRemove = _.filter(_valModelMap[facetValue], function(cid) {
						for(var value in _valModelMap) {
							if(_valModelMap.hasOwnProperty(value)) {
								// check if any other active value has a model which is also in the facet value being removed
								// if yes, the model cannot be removed from the result set 
								if(_.indexOf(_activeValues, value) !== -1 && _.indexOf(_valModelMap[value], cid) !== -1) {
									return false;
								}
							}
						}
						
						// if the model is only in the facet value being removed, then it can be removed
						return true;
					});
					
					// remove inactive models from the active models list
					_activeModels = _.difference(_activeModels, modelsToRemove);
						
					if(_operator === 'and') {
						modelsToAdd = [];
						for(var i = 0, len = _activeValues.length; i < len; i += 1) {
							if(modelsToAdd.length === 0) {
								modelsToAdd = _.union(modelsToAdd, _valModelMap[_activeValues[i]]);
							} else {
								modelsToAdd = _.intersection(modelsToAdd, _valModelMap[_activeValues[i]]);
							}
						}
						_activeModels = _.union(_activeModels, modelsToAdd);
					}
														
					_selected = _isSelected();
					
					// notify the FacetCollection to update this facet values
					vent.trigger('removeValue', _name, facetValue, _activeModels);
				}
				
				return this;
			} else {
				throw new Error('Value "'+facetValue+'" does not exist for facet '+_name);
			}
		};
		
		// removes all selected values
		this.clear = function() {
			// empty active models list
			// _activeModels.splice(0, _activeModels.length);
			// _activeValues.splice(0, _activeValues.length);
	
			// trigger clear event to notify the FacetCollection about the change
			// vent.trigger('clear', _name, _activeModels);
	
			// TODO - this is a quick fix, think of a better way
			while(_activeValues.length > 0) {
				this.removeValue(_activeValues[0]);
			}
		};
		
		this.customData = function(key, value) {
			_customData[key] = value;
	
			return this;
		};
	
		// compute values once the facet is added to the FacetCollection
		_computeValues(modelsMap);
		
		// compute facet values count on collection reset
		vent.on('resetCollection', _computeActiveValuesCount);
		
		// bind actions on Backbone Collection events, shived by the FacetCollection instance
		vent.on('resetOrigCollection', _resetFacet);
		vent.on('addModel', _addModel);
		vent.on('removeModel', _removeModel);
		vent.on('changeModel', _changeModel);
	};
	// FacetCollection class 
	var	FacetCollection = function(collection) {
		// give FacetCollection instances ability to handle Backbone Events
		_.extend(this, Backbone.Events);
		
		// init local variables
		var _self						= this,
			_facets 					= {},								// facets list
			_cidModelMap				= {},	 							// an hash containing cid/model pairs used for fast model lookup
			_activeModels				= {},								// cids of the active models for each facet (a facetName -> [cid] map)
			_vent						= _.extend({}, Backbone.Events),	// a local event handler used for local events
			_sortDir					= 'asc',
			_sortAttr,
			_filterRegex, 
			_filterAttr,
			_facetsOrder,
		
	
		// inits the models map	
		_initModelsMap	= function() {
			// clear content of _cidModelMap if any
			for(var cid in _cidModelMap) {
				if(_cidModelMap.hasOwnProperty(cid)) {
					delete _cidModelMap[cid];
				}
			}
			
			// generate a clone for each model and add it to the map with the cid as key
			collection.each(function(model) {
				var clone = model.clone();
				clone.cid = model.cid;
				_cidModelMap[model.cid] = clone;
			});
		},
		// deletes the entry for the facet with the given name from the facets hash	
		_removeFacet = function(facetName) {
			delete _facets[facetName];
		},
		// fetch (or create if not existing) a facetData object from the facets hash
		_begetFacet = function(facetName, operator) {
			var facetData = _facets[facetName];
			
			if(facetData && facetData.operator === operator) {
				return facetData;
			} else {
				var facet = new Facet(facetName, _cidModelMap, _vent, operator);
				
				// create an entry for the new facet in the facet to active models map 
				_activeModels[facetName] = [];
				
				// add operator property to the object along the actual facet reference
				return {
					facet: facet,
					operator : operator
				};
			}
		},
		_filter = function(facetName, cids) {
			// set active cids for current facet
			_activeModels[facetName] = cids;
			
			// refresh collection according to new facet filters
			_resetCollection();
		},
		_filterBy = function(facetName, facetValue, cids) {
			_filter(facetName, cids);
			
			// expose filter event
			this.trigger('filter', facetName, facetValue);
		},
		_unfilterBy = function(facetName, facetValue, cids) {
			_filter(facetName, cids);
			
			// expose unfilter event
			this.trigger('unfilter', facetName, facetValue);
		},
		_resetCollection = function(silent) {
			var modelsCids = [], models = [];
			
			// if no values are selected, return all models
			for(var cid in _cidModelMap) {
				if(_cidModelMap.hasOwnProperty(cid)) {
					modelsCids.push(cid);
				}
			}
			
			// otherwise merge the active models of each facet
			for (var key in _activeModels) {
					if (_activeModels.hasOwnProperty(key)) {
						if(_facets[key].facet.toJSON().data.selected) {
	  					if(_facets[key].operator === 'or') {
							modelsCids = _.union(modelsCids, _activeModels[key]);
						} else {
							modelsCids = _.intersection(modelsCids, _activeModels[key]);
						}	
					}
					}
			}
			
			// filterBy
			if(_filterRegex && _filterAttr) {
				modelsCids = _.filter(modelsCids, function(cid) {
					var value = _getValue(_cidModelMap[cid], _filterAttr);
					return _filterRegex.test(value);					
				});
			}
						
			// sort the models by cid
			modelsCids.sort();
			
			// create active models array retrieving clones from the cid to model hash
			for(var i = 0, len = modelsCids.length; i < len; i += 1) {
				models.push(_cidModelMap[modelsCids[i]]);
			}
			
			// reset the collecton with the active models
			collection.reset(models, { silent : true });
			
			// notify facets to recompute active facet values count
			_vent.trigger('resetCollection', modelsCids);
	
			if(!silent) {
				_self.trigger('reset', models);			
			}
		},
		// triggered whenever the Backbone collection is reset
		_resetOrigCollection = function() {
			_initModelsMap();
			// notify facets to recompute 
			_vent.trigger('resetOrigCollection', _cidModelMap);	
		},
		// triggered whenever a new Model is added to the Backbone collection
		_addModel = function(model) {
			// create a clone of the model and add it to the cid to model map
			var clone = model.clone();
			clone.cid = model.cid;
			_cidModelMap[model.cid] = clone;
			
			// notify facets about the added model
			_vent.trigger('addModel', model);
			
			// expose add event
			_self.trigger('add', model);
		},
		// // triggered whenever a Model instance is removed from the Backbone collection
		_removeModel = function(model) {
			// delete model clone from the cid to model map
			delete _cidModelMap[model.cid];
			
			// notify facets about the removed model
			_vent.trigger('removeModel', model);
			
			var anyActive = _.any(_facets, function(facetData) {
				return facetData.facet.toJSON().data.selected;
			});
			
			if(!anyActive) {
				_resetCollection();
			}
				
			// expose remove event
			_self.trigger('remove', model);
		},
		// triggered whenever a model is changed
		_modifyModel = function(model) {
			// delete old clone from models cache
			delete _cidModelMap[model.cid];
			// store new model clone with the changes in models cache
			var clone = model.clone();
			clone.cid = model.cid;
			_cidModelMap[model.cid] = clone;
			
			// notify facets about the changed model
			_vent.trigger('changeModel', model);
			
			var anyActive = _.any(_facets, function(facetData) {
				return facetData.facet.toJSON().data.selected;
			});
			
			if(!anyActive) {
				_resetCollection();
			}
			
			// expose change event
			_self.trigger('change', model);
		},
		_sort = function(silent) {
			collection.comparator = function(m1,m2) {
				var v1 = _getValue(m1, _sortAttr),
					v2 = _getValue(m2, _sortAttr),
					val1,
					val2;
					
					val1 = parseInt(v1, 10);
					val2 = parseInt(v2, 10);
				
				if(isNaN(val1) || isNaN(val2)){
					val1 = v1;
					val2 = v2;
				}
	
				if(_sortDir === "asc") {
					if(val1 && val2) {
						return (val1 > val2) - (val1 < val2);
					} else {
						if(val1) {
							return 1;
						}
						
						if(val2) {
							return -1;
						}
					}
				} else {
					if(val1 && val2) {
						return (val1 < val2) - (val1 > val2);
					} else {
						if(val1) {
							return -1;
						}
						
						if(val2) {
							return 1;
						}
					}
				}
			};
			
			collection.sort();
			
			if(!silent) {
				_self.trigger('sort', _sortAttr, _sortDir);
			}
		};
	
		// creates a Facet or fetches it from the facets map if it was already created before
		// use the given operator if any is given and it is a valid value, use default ('and') otherwise
		this.facet = function(facetName, operator) {
			var op = (operator && (operator === 'and' || operator === 'or')) ? operator : 'and';
	
			_facets[facetName] = _begetFacet(facetName, op);
				
			this.trigger('facet', facetName);
				
			return _facets[facetName].facet;
		};
				
		// returns a JSON array containing facet JSON objects for each facet added to the collection
		this.toJSON = function() {
			var key, facet, facetData, facetJSON, facetPos, facets = [], sortedFacets = [];
			for (key in _facets) {
					if (_facets.hasOwnProperty(key)) {
						facetData = _facets[key];
						facetJSON = facetData.facet.toJSON();
						// add information about the type of facet ('or' or 'and' Facet)
						facetJSON.data.operator = facetData.operator;
						
						if(_facetsOrder && _facetsOrder instanceof Array) {
							facetPos = _.indexOf(_facetsOrder, facetJSON.data.name);
							
							if(facetPos !== -1) {
								sortedFacets[facetPos] = facetJSON;
							} else {
								facets.push(facetJSON);
							}
						} else {
						facets.push(facetJSON);
						}
					}
			}
			
			return sortedFacets.concat(facets);
		};
		
		// removes all the facets assigned to this collection
		this.clear = function(silent) {
			var key;
			for (key in _facets) {
					if (_facets.hasOwnProperty(key)) {
						_facets[key].facet.remove();
					delete _facets[key];
					}
			}
			
			// resets original values in the collection
			var models = [];
			for (key in _cidModelMap) {
					if (_cidModelMap.hasOwnProperty(key)) {
						models.push(_cidModelMap[key]);
					}
			}
			
			collection.reset(models, { silent: true });
			//collection.reset(models);
			
			if(!silent) {
				this.trigger('clear', models);
			}
			
			// reset active models
			_activeModels = {};
			
			return this;
		};
		
		// deselect all the values from all the facets
		this.clearValues = function(silent) {
			var key;
	
			for (key in _facets) {
					if (_facets.hasOwnProperty(key)) {
						_facets[key].facet.clear();
					}
			}
	
			// resets original values in the collection
			var models = [];
			for (key in _cidModelMap) {
					if (_cidModelMap.hasOwnProperty(key)) {
						models.push(_cidModelMap[key]);
					}
			}
			
			collection.reset(models, { silent: true });
			
			if(!silent) {
				this.trigger('clearValues', models);
			}
	
			// reset active models
			_activeModels = {};
	
			return this;
		};
	
		// removes the collection from the _collections cache and
		// removes the facetrid property from the collection
		this.remove = function() {
			var facetrid = collection.facetrid;
			this.clear(true);
			
			// detach event listeners from collection instance
			collection.off('reset', _resetOrigCollection);
			collection.off('add', _addModel);
			collection.off('remove', _removeModel);
			collection.off('change', _modifyModel);
		
			delete collection.facetrid;
			delete _collections[facetrid];
		};
		
		// reorders facets in the JSON output according to the array of facet names given
		this.facetsOrder = function(facetNames) {
			_facetsOrder = facetNames;
			this.trigger('facetsOrderChange', facetNames);
			return this;
		};
		
		// sorts the collection by the given attribute
		this.sortBy = function(attrName, silent) {
			_sortAttr = attrName;
			_sort(silent);
			return this;
		};
		
		// sorts the collection by ascendent sort direction
		this.asc = function(silent) {
			_sortDir = 'asc';
			_sort(silent);
			return this;
		};
		
		// sorts the collection by descendent sort direction
		this.desc = function(silent) {
			_sortDir = 'desc';
			_sort(silent);
			return this;
		};
		
		// filters the collection by applying regex.test to each value in the model for the given attribute
		this.filterBy = function(attr, keywords, silent) {
			if(keywords) {
				_filterRegex = new RegExp(keywords, 'i');
			} else {
				_filterRegex = undefined;
			}
			_filterAttr = attr;
			_resetCollection(silent);
			
			return this;
		};
		
		// returns a reference to the Backbone.Collection instance
		this.collection = function(){
			return collection;
		};
	
		// returns the original collection length
		this.origLength = function() {
			return _.size(_cidModelMap);	
		};
		
		this.initFromSettingsJSON = function(json) {
			var Facetr	   = Backbone.Facetr,
				facets     = json.facets,
				sort       = json.sort,
				filter     = json.search;
				
			for(var i = 0, len = facets.length; i < len; i += 1) {
				
				var f 		= facets[i],
					attr 	= f.attr,
					eop     = f.eop,
					iop     = f.iop,
					values 	= f.vals,
					facet;
				
				facet = Facetr(collection).facet(attr, eop);
	
				if(facet) {
					for(var j = 0, len2 = values.length; j < len2; j += 1) {
						facet.value(values[j], iop);
					}
				}
			}
			
			if(sort) {
				var sattr = sort.by,
					sdir  = sort.dir;
					
				if(sattr) {
					Facetr(collection).sortBy(sattr, true);
				}
				
				if(sdir) {
					Facetr(collection)[sdir](true);
				}
			}
			
			if(filter) {
				var fattr  = filter.attr,
					fregex = filter.regex;
					
				if(fattr && fregex) {
					Facetr(collection).filterBy(fattr, fregex, true);
				}
			}
			
			this.trigger('reset');
			
			return this;
		};
		
		this.settingsJSON = function() {
			var json = {};
			
			if(_sortAttr && _sortDir) {
				json.sort = {
					'by' : _sortAttr,
					'dir' : _sortDir
				};
			}
			
			if(_filterAttr && _filterRegex) {
				json.search = {
					'attr' : _filterAttr,
					'regex' : _filterRegex.toString().replace('/i','').replace('/','')
				};
			}
			
			if(_.size(_facets) !== 0) {
				json.facets = [];
				
				for(var facet in _facets) {
					if(_facets.hasOwnProperty(facet)) {
						var facetJSON= _facets[facet].facet.toJSON(), 
						    operator = _facets[facet].operator, 
						    values = _.pluck(facetJSON.values, 'active'), 
						    activeValues = [];
						
						for(var i = 0, len = values.length; i < len; i += 1) {
							if(values[i]) {
								activeValues.push(facetJSON.values[i].value);
							}
						}
						
						json.facets.push({
							'attr' : facetJSON.data.name,
							'eop'  : facetJSON.data.extOperator,
							'iop'  : facetJSON.data.intOperator,
								'vals' : activeValues 
						});
					}
				}
			}
			
			return json;
		};
		
		// init models map
		_initModelsMap();
		
		// remove the facet from the facets hash whenever facet.remove() is invoked
		_vent.on('removeFacet', _removeFacet, this);
				
		// filter collection whenever facet.value(value) and facet.removeValue(value) are invoked
		_vent.on('value', _filterBy, this);
		_vent.on('removeValue clear', _unfilterBy, this);
		
		// bind Backbone Collection event listeners	to FacetCollection respective actions
		collection.on('reset', _resetOrigCollection);
		collection.on('add', _addModel);
		collection.on('remove', _removeModel);
		collection.on('change', _modifyModel);
	};

	return window.Facetr = Backbone.Facetr;
}));