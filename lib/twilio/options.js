"use strict";

var Log = require("./log");

exports.Options = function() {
    function Options(defaults, assignments) {
        if (!(this instanceof Options)) {
            return new Options(defaults);
        }
        this.__dict__ = {};
        defaults = defaults || {};
        assignments = assignments || {};
        Log.mixinLog(this, "[Sounds]");
        var name;
        for (name in defaults) {
            this[name] = makeprop(this.__dict__, name, this.log);
            this[name](defaults[name]);
        }
        for (name in assignments) {
            this[name](assignments[name]);
        }
    }
    var hasBeenWarned = false;
    function makeprop(__dict__, name, log) {
        return function(value) {
            if (!hasBeenWarned) {
                hasBeenWarned = true;
                log.deprecated("Device.sounds is deprecated and " + "will be removed in the next breaking release. Please use the new " + "functionality available on Device.audio.");
            }
            if (typeof value !== "undefined") {
                __dict__[name] = value;
            }
            return __dict__[name];
        };
    }
    return Options;
}();