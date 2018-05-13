(function () {
    "use strict";

    var gonzales = require("./gonzales");
    var path     = require("path");

    var HINTS_TYPE = {
        MIXIN: "mixin",
        ATTRIBUTE: "attribute",
        FUNCTION: "function",
        CLASS: "class",
        PLACEHOLDER: "placeholder",
        ID: "id",
        VARIABLE: "variable",
        ARGUMENT: "argument",
        IMPORT: "import"
    };

    var TYPE_HASH = {
        MIXIN: 1<<0,
        ATTRIBUTE: 1<<1,
        ATRULE: 1<<2,
        FUNCTION: 1<<3,
        IMPORT: 1<<4,
        CLASS: 1<<5,
        PLACEHOLDER: 1<<6,
        ID: 1<<7,
        VARIABLE: 1<<8
    };

    var RULE_MAP = {
        MIXIN: ".mixin.ident",
        ATTRIBUTE: ".attributeName.ident",
        ATRULE: ".atrule.atkeyword",
        CLASS: ".ruleset.selector.class.ident",
        PLACEHOLDER: ".ruleset.selector.placeholder.ident",
        ID: ".ruleset.selector.id.ident",
        VARIABLE: ".declaration.property",
        ARGUMENT: ".arguments",
        VALUE: ".value"
    };

    var PARAM_TYPE = {
        REQUIRED: 1,
        OPTIONAL: 2,
        VARSLIST: 3
    };

    var ALL_HINTS_HASH = TYPE_HASH.MIXIN | TYPE_HASH.ATTRIBUTE | TYPE_HASH.ATRULE
                            | TYPE_HASH.FUNCTION | TYPE_HASH.IMPORT |  TYPE_HASH.CLASS
                            | TYPE_HASH.PLACEHOLDER | TYPE_HASH.ID | TYPE_HASH.VARIABLE;

    var BLOCK_STR = "@";
    
    //Polyfils taken from MDN
    if (!String.prototype.endsWith) {
        String.prototype.endsWith = function (search, this_len) {
            if (this_len === undefined || this_len > this.length) {
                this_len = this.length;
            }
            return this.substring(this_len - search.length, this_len) === search;
        };
    }

    if (!String.prototype.includes) {
        String.prototype.includes = function (search, start) {

            if (typeof start !== 'number') {
                start = 0;
            }

            if (start + search.length > this.length) {
                return false;
            }
            return this.indexOf(search, start) !== -1;

        };
    }

    function createContextID(node, type) {
        var s = node.start,
            e = node.end;

        return [BLOCK_STR, [s.line, s.column].join(":"), [e.line, e.column].join(":")].join("#");
    }

    function getRange(node) {
        //NOTE: Will only work for non-space/return ident type nodes.
        return {
            from: {
                line: node.start.line,
                ch: node.start.column
            },
            to: {
                line: node.start.line,
                ch: node.start.column + node.content.length
            }
        };
    }

    function isInBlock(blockNode, cursorPos) {
        var start = blockNode.start,
            end = blockNode.end,
            retval = false;

        if (cursorPos.line > start.line && cursorPos.line < end.line) {
            retval = true;
        } else if (cursorPos.line === start.line && cursorPos.line === end.line) {
            if (cursorPos.column >= start.column && cursorPos.column < end.column) {
                retval = true;
            }
        } else if (cursorPos.line === start.line) {
            if (cursorPos.column >= start.column) {
                retval = true;
            }
        } else if (cursorPos.line === end.line) {
            if (cursorPos.column < end.column) {
                retval = true;
            }
        }

        return retval;
    }

    function getTypeHash(types) {
        var hash = 0;

        types.forEach(function (type) {
            switch(type) {
            case HINTS_TYPE.MIXIN       : hash = (hash | TYPE_HASH.MIXIN); break;
            case HINTS_TYPE.ATTRIBUTE   : hash = (hash | TYPE_HASH.ATTRIBUTE); break;
            case HINTS_TYPE.FUNCTION    : hash = (hash | TYPE_HASH.ATRULE
                                                       | TYPE_HASH.FUNCTION); break;
            case HINTS_TYPE.CLASS       : hash = (hash | TYPE_HASH.CLASS); break;
            case HINTS_TYPE.PLACEHOLDER : hash = (hash | TYPE_HASH.PLACEHOLDER); break;
            case HINTS_TYPE.ID          : hash = (hash | TYPE_HASH.ID); break;
            case HINTS_TYPE.VARIABLE    : hash = (hash | TYPE_HASH.VARIABLE | TYPE_HASH.ATRULE
                                                       | TYPE_HASH.FUNCTION | TYPE_HASH.MIXIN);
                break;
            case HINTS_TYPE.ARGUMENT    : hash = (hash | TYPE_HASH.ATRULE
                                                       | TYPE_HASH.FUNCTION | TYPE_HASH.MIXIN);
                break;
            case HINTS_TYPE.IMPORT      : hash = (hash | TYPE_HASH.ATRULE | TYPE_HASH.IMPORT);
                break;
            }
        });

        return hash;
    }

    function isRequestedType(typeHash, type) {
        return (typeHash & type) === type;
    }

    function getValueForVariable(node) {
        var retval = "";

        node.forEach(function(child, index, parent){
            //values can be complex like "inset #{$var}px 32px 41px -28px rgba(0,0,0,0.44)"
            //so they can contain function or even interpolation
            //Broken into 4 case: [ident, composite-ident, interpolation, parameter]
            if(typeof child.content === "string") {
                var isColor = child.type === "color";
                if (isColor) {
                    retval = retval + "#" + child.content;
                } else {
                    retval = retval + child.content;
                }
            } else {
                switch (child.type) {
                case "variable": {
                    retval = retval + "$" + child.first("ident").content;
                    break;
                }
                case "interpolation": {
                    retval = retval + "#{" + getValueForVariable(child) + "}";
                    break;
                }
                case "function" : {
                    retval = retval + child.first("ident").content;

                    var argumentNode = child.first("arguments");
                    retval = retval + "("+ getValueForVariable(argumentNode) +")";
                    break;
                }
                default : {
                        //composite-ident case
                    child.traverse(function(_node) {
                        if (typeof _node.content === "string") {
                            var isColor = _node.type === "color";
                            if (isColor) {
                                retval = retval + "#" + _node.content;
                            } else {
                                retval = retval + _node.content;
                            }
                        }   
                    });
                }
                }
            }
        });

        return retval;
    }

    function filterHintsByBlockLevel(completeMap, blocklevel) {
        var filteredMap = {};

        for (var type in completeMap) {
            if (completeMap.hasOwnProperty(type)) {
                switch(type) {
                case HINTS_TYPE.MIXIN:
                case HINTS_TYPE.FUNCTION:
                case HINTS_TYPE.PLACEHOLDER:
                case HINTS_TYPE.VARIABLE:
                case HINTS_TYPE.IMPORT:
                case HINTS_TYPE.ARGUMENT:
                    filteredMap[type] = completeMap[type].filter(function (hint) {
                        return (hint.blocklevel <= blocklevel);
                    });
                    break;
                default :
                    filteredMap[type] = completeMap[type];
                }
            }
        }

        return filteredMap;
    }

    function filterHintsByContext(completeMap, contextChain) {
        var filteredMap = {};

        for (var type in completeMap) {
            if (completeMap.hasOwnProperty(type)) {
                switch(type) {
                case HINTS_TYPE.MIXIN:
                case HINTS_TYPE.FUNCTION:
                case HINTS_TYPE.PLACEHOLDER:
                case HINTS_TYPE.VARIABLE:
                case HINTS_TYPE.IMPORT:
                case HINTS_TYPE.ARGUMENT:
                    filteredMap[type] = completeMap[type].filter(function (hint) {
                        return (contextChain.indexOf(hint.contextID) !== -1);
                    });
                    break;
                default :
                    filteredMap[type] = completeMap[type];
                }
            }
        }

        return filteredMap;
    }

    function getNewHintMap() {
        return {
            import: [],
            function: [],
            mixin: [],
            variable: [],
            id: [],
            class: [],
            attribute: [],
            placeholder: [],
            argument: []
        };
    }

    function Analyzer(filePath, text, inferTimeout) {
        this.hintMap = getNewHintMap();
        this.captured = 0;
        this.timeout = inferTimeout || null;

        this.contextMap = {};
        this.globalContext = null;
        this.source = path.basename(filePath);

        this.tree = null;
        this.createAST(text);
    }

    Analyzer.prototype.annotateNodeForAnalysis =  function(node, parent) {
        //Add blocklevel and context information
        if (!parent) {
            node.blocklevel = 0;
            node.contextID = createContextID(node);

            this.contextMap[node.contextID] = null;
            this.globalContext = node.contextID;
        } else {
            node.blocklevel = parent.blocklevel;
            node.contextID = parent.contextID;
        }

        if (node.type === "block") {
            node.blocklevel = node.blocklevel + 1;
            node.contextID = createContextID(node);

            this.contextMap[node.contextID] = parent.contextID;
        }

        //Add complete type information
        if (parent) {
            node.completeType = parent.completeType + "." + node.type;
        } else {
            node.completeType = node.type;
        }
    };

    Analyzer.prototype.createAST = function (text) {
        var self = this;

        self.tree = gonzales.parse(text, {
            syntax: "scss"
        });

        self.tree.traverse(function (node, index, parent) {
            //Remove extraneous node
            if (!parent || !parent.completeType.includes(RULE_MAP.VALUE)) {
                switch(node.type) {
                case "space":
                case "propertyDelimiter":
                case "declarationDelimiter":
                case "delimiter":
                    parent.removeChild(index);
                }
            }

            self.annotateNodeForAnalysis(node, parent);
        });
    };

    Analyzer.prototype.addNodeForType = function(node, type) {
        if (!node) {
            return;
        }

        var hintObject = {};
        switch (type) {
        case HINTS_TYPE.MIXIN :
        case HINTS_TYPE.FUNCTION :
            hintObject.value = node.content;
            if(node.arguments) {
                hintObject.definition = hintObject.value + "(" + node.arguments.join(", ") + ")";
            }
        case HINTS_TYPE.ATTRIBUTE :
            hintObject.value = node.content;
            break;
        case HINTS_TYPE.CLASS :
            hintObject.value = "." + node.content;
            break;
        case HINTS_TYPE.PLACEHOLDER :
            hintObject.value = "%" + node.content;
            break;
        case HINTS_TYPE.ID :
            hintObject.value = "#" + node.content;
            break;
        case HINTS_TYPE.VARIABLE :
        case HINTS_TYPE.ARGUMENT :
            hintObject.value = "$" + node.content;

            if (node.definition) {
                hintObject.definition = node.definition;
            }
            break;
        case HINTS_TYPE.IMPORT :
            hintObject.value = node.content.replace(/\"/g, "");
            break;

        }
        hintObject.type = type;
        hintObject.source = this.source;
        hintObject.range = getRange(node);
        hintObject.blocklevel = node.blocklevel;
        hintObject.contextID = node.contextID;

        this.hintMap[type].push(hintObject);
    };

    Analyzer.prototype.captureType = function(typeHash, key, node, index, parent) {
        if (!isRequestedType(typeHash, TYPE_HASH[key])) {
            return;
        }

        if (!node) {
            return;
        }

        if (node.completeType.endsWith(RULE_MAP[key])) {
            this.addNodeForType(node, HINTS_TYPE[key]);
        }
    };

    Analyzer.prototype.captureAttributes = function(typeHash, node, index, parent) {
        var key = "ATTRIBUTE";
        this.captureType(typeHash, key, node, index, parent);
    };

    Analyzer.prototype.captureClasses = function(typeHash, node, index, parent) {
        var key = "CLASS";
        this.captureType(typeHash, key, node, index, parent);
    };

    Analyzer.prototype.capturePlaceholders = function(typeHash, node, index, parent) {
        var key = "PLACEHOLDER";
        this.captureType(typeHash, key, node, index, parent);
    };

    Analyzer.prototype.captureIds = function(typeHash, node, index, parent) {
        var key = "ID";
        this.captureType(typeHash, key, node, index, parent);
    };

    Analyzer.prototype.captureVariables = function(typeHash, node, index, parent) {
        if (!isRequestedType(typeHash, TYPE_HASH.VARIABLE)) {
            return;
        }

        if (!node && !parent) {
            return;
        }

        if (node.completeType.endsWith(RULE_MAP.VARIABLE)) {
            if (node.completeType.includes(RULE_MAP.ARGUMENT)) {
                return;
            }

            var varNode = node.first("variable");

            if (varNode) {
                var identNode = varNode.first("ident");

                if (identNode) {
                    var valueNode = parent.first("value");

                    if (valueNode) {
                        var value = getValueForVariable(valueNode);
                        if(value) {
                            identNode.definition = value;
                        }

                        if(valueNode.contains("global")) {
                            identNode.blocklevel = 0;
                            identNode.contextID = this.globalContext;
                        }

                        this.addNodeForType(identNode, HINTS_TYPE.VARIABLE);
                    } else {
                        this.addNodeForType(identNode, HINTS_TYPE.VARIABLE);
                    }
                }
            }
        }
    };

    Analyzer.prototype.captureAtrules = function(typeHash, node, index, parent) {
        if (!isRequestedType(typeHash, TYPE_HASH.ATRULE)) {
            return;
        }

        if(!node && !parent) {
            return;
        }

        if (node.completeType.endsWith(RULE_MAP.ATRULE)) {
            this.captureImports(typeHash, node, index, parent);
            this.captureFunctions(typeHash, node, index, parent);
        }
    };

    Analyzer.prototype.captureFunctions = function(typeHash, node, index, parent) {
        if (!isRequestedType(typeHash, TYPE_HASH.FUNCTION)) {
            return;
        }

        if (!node && !parent) {
            return;
        }

        var identNode = node.first("ident");
        if (identNode && identNode.content === "function") {
            var functionVal = parent.first("function");
            if (functionVal) {
                var functionIdent = functionVal.first("ident");
                if (functionIdent) {
                    var argumentsNode = functionVal.first("arguments");
                    if(argumentsNode) {
                        functionIdent.arguments = this.getArguments(argumentsNode, parent);
                    }
                    this.addNodeForType(functionIdent, HINTS_TYPE.FUNCTION);
                }
            }
        }
    };

    Analyzer.prototype.captureImports = function(typeHash, node, index, parent) {
        if (!isRequestedType(typeHash, TYPE_HASH.IMPORT)) {
            return;
        }

        if (!node && !parent) {
            return;
        }

        var identNode = node.first("ident");
        if (identNode && identNode.content === "import") {
            var importVal = parent.first("string");
            if (importVal) {
                this.addNodeForType(importVal, HINTS_TYPE.IMPORT);
            } else {
                importVal = parent.first("uri");
                if (importVal) {
                    var importIdent = importVal.first();
                    if(importIdent && (importIdent.is("string") || importIdent.is("raw"))) {
                        this.addNodeForType(importIdent, HINTS_TYPE.IMPORT);
                    }
                }
            }
        }
    };

    Analyzer.prototype.captureMixins = function(typeHash, node, index, parent) {
        if (!isRequestedType(typeHash, TYPE_HASH.MIXIN)) {
            return;
        }

        if(!node && !parent) {
            return;
        }

        if (node.completeType.endsWith(RULE_MAP.MIXIN)) {
            var argumentsNode;
            if(argumentsNode = parent.first("arguments")) {
                node.arguments = this.getArguments(argumentsNode, parent);
            }
            this.addNodeForType(node, HINTS_TYPE.MIXIN);
        }
    };

    Analyzer.prototype.getArguments = function(argumentsNode, scopeRoot) {
        var argsArr = [],
            associatedBlock,
            self = this;

        if(!argumentsNode && !scopeRoot
           && !(associatedBlock = scopeRoot.first("block"))) {
            return argsArr;
        }


        var associatedBlock = scopeRoot.first("block");
        var blocklevelForArgs = associatedBlock.blocklevel;
        var contextIDForArgs = associatedBlock.contextID;

        function getArgsString(idNode) {
            var retval = "";

            if (idNode) {
                switch(idNode.paramType) {
                case PARAM_TYPE.REQUIRED :
                    retval = "$" + idNode.content;
                    break;
                case PARAM_TYPE.OPTIONAL :
                    retval = "[$" + idNode.content + " : " + idNode.definition + "]";
                    break;
                case PARAM_TYPE.VARSLIST :
                    retval = "$" + idNode.content + "...";
                    break;
                }
            }

            return retval;
        }

        argumentsNode.forEach(function(child, index, parent){
            var identifierNode;

            switch (child.type) {
            case "variable":
                identifierNode = child.first("ident");
                identifierNode.paramType = PARAM_TYPE.REQUIRED;
                break;
            case "declaration":
                var propertyNode = child.first("property");
                var variableNode = propertyNode ? propertyNode.first("variable") : null;
                identifierNode = variableNode ? variableNode.first("ident") : null;

                var valueNode = child.first("value");
                var value = getValueForVariable(valueNode);
                if(value) {
                    identifierNode.definition = value;
                    identifierNode.paramType = PARAM_TYPE.OPTIONAL;
                } else {
                    identifierNode.paramType = PARAM_TYPE.REQUIRED;
                }
                break;
            case "variablesList":
                var variableNode = child.first("variable");
                identifierNode = variableNode ? variableNode.first("ident") : null;
                identifierNode.paramType = PARAM_TYPE.VARSLIST;
                break;
            }

            if (identifierNode) {
                var variableName = getArgsString(identifierNode);
                argsArr.push(variableName);

                identifierNode.blocklevel = blocklevelForArgs;
                identifierNode.contextID = contextIDForArgs;
                self.addNodeForType(identifierNode, "argument");
            }
        });

        return argsArr;
    };

    Analyzer.prototype.captureHints = function(typeHash, node, index, parent) {
        this.captureMixins(typeHash, node, index, parent);
        this.captureAttributes(typeHash, node, index, parent);
        this.captureAtrules(typeHash, node, index, parent);
        this.captureClasses(typeHash, node, index, parent);
        this.capturePlaceholders(typeHash, node, index, parent);
        this.captureIds(typeHash, node, index, parent);
        this.captureVariables(typeHash, node, index, parent);
    };

    Analyzer.prototype.isChildBlock = function (childContext, parentContext) {
        return (this.contextMap[childContext] === parentContext);
    };

    Analyzer.prototype.getContextChain = function(cursorPos) {
        var contextChain = [this.globalContext];

        if (this.tree) {
            var self = this;
            this.tree.traverseByType("block", function(blockNode, index, parent){
                var childContext = blockNode.contextID,
                    chainTop = contextChain.length - 1,
                    parentContext = contextChain[chainTop];

                if (isInBlock(blockNode, cursorPos)
                    && self.isChildBlock(childContext, parentContext)) {
                    contextChain.push(childContext);
                }
            });
        }

        return contextChain;
    };

    Analyzer.prototype._getHints = function(typeHash) {
        if (!this.tree) {
            return null;
        }

        var self = this,
            limit = 0,
            hasTimelimit = false;
        
        if (this.timeout && typeof this.timeout === "number") {
            limit = +new Date + this.timeout;
            hasTimelimit = true;
        }
        
        try {
            self.tree.traverse(function(node, index, parent) {
                if (hasTimelimit && (+new Date >= limit)) {
                    throw new Error("The analyzer for " + self.source + " timed out. Results may not be accurate/complete.");
                }
                self.captureHints(typeHash, node, index, parent);
            });
        } catch (e) {
            console.log(e.message);
        }
        this.captured = this.captured | typeHash;

        return this.hintMap;
    };
    
    Analyzer.prototype.refresh = function() {
        this.hintMap = getNewHintMap();
        this.captured = 0;
    }
    
    Analyzer.prototype.setTimeout = function(timeout) {
        //timeout specified in milliseconds
        if (timeout && typeof timeout === "number") {
            this.timeout = timeout;
            //We should only setTimeout again to retry inference
            //and we reset the existing inferences
            this.refresh();
        }
    }

    Analyzer.prototype.getAllHints = function() {
        var retval = this.hintMap,
            typeHash = ALL_HINTS_HASH ^ this.captured;

        if(typeHash) {
            retval = this._getHints(typeHash);
        }

        return retval;
    };

    Analyzer.prototype.getAllGlobalHints = function() {
        var retval = this.getAllHints(),
            retval = filterHintsByBlockLevel(retval, 0);

        return retval;
    };

    Analyzer.prototype.getGlobalHints = function(typeObj) {
        var retval = this.getHints(typeObj),
            retval = filterHintsByBlockLevel(this.hintMap, 0);

        return retval;
    };

    Analyzer.prototype.getHints = function(typeObj) {
        var retval = this.hintMap,
            typeHash = 0;

        switch(typeof typeObj) {
        case "string": {
            typeHash = getTypeHash([typeObj]);
        }
        case "object": {
            if (Array.isArray(typeObj)) {
                typeHash = getTypeHash(typeObj);
            }
        }
        }
        typeHash = (typeHash & this.captured) ^ typeHash;

        if(typeHash) {
            retval = this._getHints(typeHash);
        }

        return retval;
    };

    Analyzer.prototype.getHintsForCursorPos = function(typeObj, cursorPos) {
        var retval = this.getHints(typeObj),
            contextChain = this.getContextChain(cursorPos);

        retval = filterHintsByContext(retval, contextChain);

        return retval;
    };

    Analyzer.prototype.reset = function(filePath, text) {
        this.hintMap = getNewHintMap();
        this.captured = 0;

        this.contextMap = {};
        this.globalContext = null;
        this.source = path.basename(filePath);

        this.tree = null;
        this.createAST(text);
    };

    exports.Analyzer = Analyzer;
}());
