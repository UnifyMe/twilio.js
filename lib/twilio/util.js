"use strict";

var EventEmitter = require("events").EventEmitter;

var generateEventWarning = require("./strings").generateEventWarning;

function getPStreamVersion() {
    return "1.4" || "1.0";
}

function getSDKHash() {
    return "f5264f9";
}

function getReleaseVersion() {
    return "1.4.25";
}

function getSoundVersion() {
    return "1.0.0" || "1.0.0";
}

function getTwilioRoot() {
    return "https://media.twiliocdn.com/sdk/js/client/";
}

function TwilioException(message) {
    if (!(this instanceof TwilioException)) {
        return new TwilioException(message);
    }
    this.message = message;
}

TwilioException.prototype.toString = function() {
    return "Twilio.Exception: " + this.message;
};

function memoize(fn) {
    return function() {
        var args = Array.prototype.slice.call(arguments, 0);
        fn.memo = fn.memo || {};
        if (!fn.memo[args]) {
            fn.memo[args] = fn.apply(null, args);
        }
        return fn.memo[args];
    };
}

function decodePayload(encodedPayload) {
    var remainder = encodedPayload.length % 4;
    if (remainder > 0) {
        var padlen = 4 - remainder;
        encodedPayload += new Array(padlen + 1).join("=");
    }
    encodedPayload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    var decodedPayload = _atob(encodedPayload);
    return JSON.parse(decodedPayload);
}

var memoizedDecodePayload = memoize(decodePayload);

function decode(token) {
    var segs = token.split(".");
    if (segs.length !== 3) {
        throw new TwilioException("Wrong number of segments");
    }
    var encodedPayload = segs[1];
    var payload = memoizedDecodePayload(encodedPayload);
    return payload;
}

function makedict(params) {
    if (params === "") {
        return {};
    }
    if (params.indexOf("&") === -1 && params.indexOf("=") === -1) {
        return params;
    }
    var pairs = params.split("&");
    var result = {};
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split("=");
        result[decodeURIComponent(pair[0])] = makedict(decodeURIComponent(pair[1]));
    }
    return result;
}

function makescope(uri) {
    var parts = uri.match(/^scope:(\w+):(\w+)\??(.*)$/);
    if (!(parts && parts.length === 4)) {
        throw new TwilioException("Bad scope URI");
    }
    return {
        service: parts[1],
        privilege: parts[2],
        params: makedict(parts[3])
    };
}

function urlencode(paramsDict, doseq) {
    var parts = [];
    var value;
    doseq = doseq || false;
    for (var key in paramsDict) {
        if (doseq && paramsDict[key] instanceof Array) {
            for (var index in paramsDict[key]) {
                value = paramsDict[key][index];
                parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
            }
        } else {
            value = paramsDict[key];
            parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
        }
    }
    return parts.join("&");
}

function objectize(token) {
    var jwt = decode(token);
    var scopes = jwt.scope.length === 0 ? [] : jwt.scope.split(" ");
    var newscopes = {};
    for (var i = 0; i < scopes.length; i++) {
        var scope = makescope(scopes[i]);
        newscopes[scope.service + ":" + scope.privilege] = scope;
    }
    jwt.scope = newscopes;
    return jwt;
}

var memoizedObjectize = memoize(objectize);

function _btoa(message) {
    try {
        return btoa(message);
    } catch (e) {
        return new Buffer(message).toString("base64");
    }
}

function _atob(encoded) {
    try {
        return atob(encoded);
    } catch (e) {
        try {
            return new Buffer(encoded, "base64").toString("ascii");
        } catch (e2) {
            return base64.decode(encoded);
        }
    }
}

function dummyToken(payload) {
    var tokenDefaults = {
            iss: "AC1111111111111111111111111111111",
            exp: 14e8
        };
    for (var k in tokenDefaults) {
        payload[k] = payload[k] || tokenDefaults[k];
    }
    var encodedPayload = _btoa(JSON.stringify(payload));
    encodedPayload = encodedPayload.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    return [ "*", encodedPayload, "*" ].join(".");
}

function bind(fn, ctx) {
    var applied = Array.prototype.slice.call(arguments, 2);
    return function() {
        var extra = Array.prototype.slice.call(arguments);
        return fn.apply(ctx, applied.concat(extra));
    };
}

function getSystemInfo() {
    var version = getPStreamVersion();
    var hash = getSDKHash();
    var nav = typeof navigator !== "undefined" ? navigator : {};
    var info = {
            p: "browser",
            v: version,
            h: hash,
            browser: {
                userAgent: nav.userAgent || "unknown",
                platform: nav.platform || "unknown"
            },
            plugin: "rtc"
        };
    return info;
}

function trim(str) {
    if (typeof str !== "string") {
        return "";
    }
    if (str.trim) {
        return str.trim();
    } else {
        return str.replace(/^\s+|\s+$/g, "");
    }
}

function splitObjects(json) {
    var trimmed = trim(json);
    if (trimmed.length === 0) {
        return [];
    } else {
        return trimmed.split("\n");
    }
}

function generateConnectionUUID() {
    return "TJSxxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === "x" ? r : r & 3 | 8;
        return v.toString(16);
    });
}

function monitorEventEmitter(name, object) {
    object.setMaxListeners(0);
    var MAX_LISTENERS = 10;
    function monitor(event) {
        var n = EventEmitter.listenerCount(object, event);
        var warning = generateEventWarning(event, name, MAX_LISTENERS);
        if (n >= MAX_LISTENERS) {
            if (typeof console !== "undefined") {
                if (console.warn) {
                    console.warn(warning);
                } else if (console.log) {
                    console.log(warning);
                }
            }
            object.removeListener("newListener", monitor);
        }
    }
    object.on("newListener", monitor);
}

function deepEqual(a, b) {
    if (a === b) {
        return true;
    } else if (typeof a !== typeof b) {
        return false;
    } else if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    } else if (typeof a !== "object" && typeof b !== "object") {
        return a === b;
    }
    return objectDeepEqual(a, b);
}

var objectKeys = typeof Object.keys === "function" ? Object.keys : function(obj) {
        var keys = [];
        for (var key in obj) {
            keys.push(key);
        }
        return keys;
    };

function isUndefinedOrNull(a) {
    return typeof a === "undefined" || a === null;
}

function objectDeepEqual(a, b) {
    if (isUndefinedOrNull(a) || isUndefinedOrNull(b)) {
        return false;
    } else if (a.prototype !== b.prototype) {
        return false;
    }
    try {
        var ka = objectKeys(a);
        var kb = objectKeys(b);
    } catch (e) {
        return false;
    }
    if (ka.length !== kb.length) {
        return false;
    }
    ka.sort();
    kb.sort();
    for (var i = ka.length - 1; i >= 0; i--) {
        var k = ka[i];
        if (!deepEqual(a[k], b[k])) {
            return false;
        }
    }
    return true;
}

function average(values) {
    return values.reduce(function(t, v) {
        return t + v;
    }) / values.length;
}

function difference(lefts, rights, getKey) {
    getKey = getKey || function(a) {
        return a;
    };
    var rightKeys = new Set(rights.map(getKey));
    return lefts.filter(function(left) {
        return !rightKeys.has(getKey(left));
    });
}

function encodescope(service, privilege, params) {
    var capability = [ "scope", service, privilege ].join(":");
    var empty = true;
    for (var _ in params) {
        void _;
        empty = false;
        break;
    }
    if (empty) {
        return capability;
    } else {
        return capability + "?" + buildquery(params);
    }
}

function buildquery(params) {
    var pairs = [];
    for (var name in params) {
        var value = typeof params[name] === "object" ? buildquery(params[name]) : params[name];
        pairs.push(encodeURIComponent(name) + "=" + encodeURIComponent(value));
    }
}

function isFirefox(navigator) {
    navigator = navigator || (typeof window === "undefined" ? global.navigator : window.navigator);
    return navigator && typeof navigator.userAgent === "string" && /firefox|fxios/i.test(navigator.userAgent);
}

function isEdge(navigator) {
    navigator = navigator || (typeof window === "undefined" ? global.navigator : window.navigator);
    return navigator && typeof navigator.userAgent === "string" && /edge\/\d+/i.test(navigator.userAgent);
}

exports.getPStreamVersion = getPStreamVersion;

exports.getReleaseVersion = getReleaseVersion;

exports.getSoundVersion = getSoundVersion;

exports.dummyToken = dummyToken;

exports.Exception = TwilioException;

exports.decode = decode;

exports.btoa = _btoa;

exports.atob = _atob;

exports.objectize = memoizedObjectize;

exports.urlencode = urlencode;

exports.encodescope = encodescope;

exports.Set = Set;

exports.bind = bind;

exports.getSystemInfo = getSystemInfo;

exports.splitObjects = splitObjects;

exports.generateConnectionUUID = generateConnectionUUID;

exports.getTwilioRoot = getTwilioRoot;

exports.monitorEventEmitter = monitorEventEmitter;

exports.deepEqual = deepEqual;

exports.average = average;

exports.difference = difference;

exports.isFirefox = isFirefox;

exports.isEdge = isEdge;