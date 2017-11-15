"use strict";

function mixinLog(object, prefix) {
    function log() {
        if (!log.enabled) {
            return;
        }
        var format = log.prefix ? log.prefix + " " : "";
        for (var i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            log.handler(typeof arg === "string" ? format + arg : arg);
        }
    }
    function defaultWarnHandler(x) {
        if (typeof console !== "undefined") {
            if (typeof console.warn === "function") {
                console.warn(x);
            } else if (typeof console.log === "function") {
                console.log(x);
            }
        }
    }
    function deprecated() {
        if (!log.warnings) {
            return;
        }
        for (var i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            log.warnHandler(arg);
        }
    }
    log.enabled = true;
    log.prefix = prefix || "";
    log.defaultHandler = function(x) {
        if (typeof console !== "undefined") {
            console.log(x);
        }
    };
    log.handler = log.defaultHandler;
    log.warnings = true;
    log.defaultWarnHandler = defaultWarnHandler;
    log.warnHandler = log.defaultWarnHandler;
    log.deprecated = deprecated;
    object.log = log;
}

exports.mixinLog = mixinLog;