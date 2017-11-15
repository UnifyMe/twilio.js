"use strict";

var EventEmitter = require("events").EventEmitter;

var util = require("util");

var log = require("./log");

var twutil = require("./util");

var WSTransport = require("./wstransport").WSTransport;

function PStream(token, options) {
    if (!(this instanceof PStream)) {
        return new PStream(token, options);
    }
    twutil.monitorEventEmitter("Twilio.PStream", this);
    var defaults = {
            logPrefix: "[PStream]",
            chunderw: "chunderw-vpc-gll.twilio.com",
            secureSignaling: true,
            transportFactory: WSTransport,
            debug: false
        };
    options = options || {};
    for (var prop in defaults) {
        if (prop in options) {
            continue;
        }
        options[prop] = defaults[prop];
    }
    this.options = options;
    this.token = token || "";
    this.status = "disconnected";
    this.host = this.options.chunderw;
    this.gateway = null;
    this.region = null;
    log.mixinLog(this, this.options.logPrefix);
    this.log.enabled = this.options.debug;
    this.on("error", function() {});
    var self = this;
    this.addListener("ready", function() {
        self.status = "ready";
    });
    this.addListener("offline", function() {
        self.status = "offline";
    });
    this.addListener("close", function() {
        self.destroy();
    });
    var opt = {
            host: this.host,
            debug: this.options.debug,
            secureSignaling: this.options.secureSignaling
        };
    this.transport = this.options.transportFactory(opt);
    this.transport.onopen = function() {
        self.status = "connected";
        self.setToken(self.token);
    };
    this.transport.onclose = function() {
        if (self.status !== "disconnected") {
            if (self.status !== "offline") {
                self.emit("offline", self);
            }
            self.status = "disconnected";
        }
    };
    this.transport.onerror = function(err) {
        self.emit("error", err);
    };
    this.transport.onmessage = function(msg) {
        var objects = twutil.splitObjects(msg.data);
        for (var i = 0; i < objects.length; i++) {
            var obj = JSON.parse(objects[i]);
            var eventType = obj.type;
            var payload = obj.payload || {};
            if (payload.gateway) {
                self.gateway = payload.gateway;
            }
            if (payload.region) {
                self.region = payload.region;
            }
            self.emit(eventType, payload);
        }
    };
    this.transport.open();
    return this;
}

util.inherits(PStream, EventEmitter);

PStream.toString = function() {
    return "[Twilio.PStream class]";
};

PStream.prototype.toString = function() {
    return "[Twilio.PStream instance]";
};

PStream.prototype.setToken = function(token) {
    this.log("Setting token and publishing listen");
    this.token = token;
    var payload = {
            token: token,
            browserinfo: twutil.getSystemInfo()
        };
    this.publish("listen", payload);
};

PStream.prototype.register = function(mediaCapabilities) {
    var regPayload = {
            media: mediaCapabilities
        };
    this.publish("register", regPayload);
};

PStream.prototype.destroy = function() {
    this.log("Closing PStream");
    this.transport.close();
    return this;
};

PStream.prototype.publish = function(type, payload) {
    var msg = JSON.stringify({
            type: type,
            version: twutil.getPStreamVersion(),
            payload: payload
        });
    this.transport.send(msg);
};

exports.PStream = PStream;