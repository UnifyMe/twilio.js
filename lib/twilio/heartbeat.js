"use strict";

function Heartbeat(opts) {
    if (!(this instanceof Heartbeat)) {
        return new Heartbeat(opts);
    }
    opts = opts || {};
    function noop() {}
    var defaults = {
            interval: 10,
            now: function() {
                return new Date().getTime();
            },
            repeat: function(f, t) {
                return setInterval(f, t);
            },
            stop: function(f, t) {
                return clearInterval(f, t);
            },
            onsleep: noop,
            onwakeup: noop
        };
    for (var prop in defaults) {
        if (prop in opts) {
            continue;
        }
        opts[prop] = defaults[prop];
    }
    this.interval = opts.interval;
    this.lastbeat = 0;
    this.pintvl = null;
    this.onsleep = opts.onsleep;
    this.onwakeup = opts.onwakeup;
    this.repeat = opts.repeat;
    this.stop = opts.stop;
    this.now = opts.now;
}

Heartbeat.toString = function() {
    return "[Twilio.Heartbeat class]";
};

Heartbeat.prototype.toString = function() {
    return "[Twilio.Heartbeat instance]";
};

Heartbeat.prototype.beat = function() {
    this.lastbeat = this.now();
    if (this.sleeping()) {
        if (this.onwakeup) {
            this.onwakeup();
        }
        var self = this;
        this.pintvl = this.repeat.call(null, function() {
            self.check();
        }, this.interval * 1e3);
    }
};

Heartbeat.prototype.check = function() {
    var timeidle = this.now() - this.lastbeat;
    if (!this.sleeping() && timeidle >= this.interval * 1e3) {
        if (this.onsleep) {
            this.onsleep();
        }
        this.stop.call(null, this.pintvl);
        this.pintvl = null;
    }
};

Heartbeat.prototype.sleeping = function() {
    return this.pintvl === null;
};

exports.Heartbeat = Heartbeat;