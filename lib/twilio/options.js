"use strict";

var Log = require("./log");

var SOUNDS_DEPRECATION_WARNING = require("./strings").SOUNDS_DEPRECATION_WARNING;

exports.Options = function() {
    function Options(defaults, assignments) {
        if (!(this instanceof Options)) {
            return new Options(defaults);
        }
        this.__dict__ = {};
        defaults = defaults || {};
        assignments = assignments || {};
        Log.mixinLog(this, "[Sounds]");
        var hasBeenWarned = false;
        function makeprop(__dict__, name, log) {
            return function(value, shouldSilence) {
                if (!shouldSilence && !hasBeenWarned) {
                    hasBeenWarned = true;
                    log.deprecated(SOUNDS_DEPRECATION_WARNING);
                }
                if (typeof value !== "undefined") {
                    __dict__[name] = value;
                }
                return __dict__[name];
            };
        }
        var name;
        for (name in defaults) {
            this[name] = makeprop(this.__dict__, name, this.log);
            this[name](defaults[name], true);
        }
        for (name in assignments) {
            this[name](assignments[name], true);
        }
    }
    return Options;
}();