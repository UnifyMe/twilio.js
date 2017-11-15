"use strict";

var Heartbeat = require("./heartbeat").Heartbeat;

var log = require("./log");

var DefaultWebSocket = require("ws");

function noop() {}

function getTime() {
    return new Date().getTime();
}

function WSTransport(options) {
    if (!(this instanceof WSTransport)) {
        return new WSTransport(options);
    }
    var self = this;
    self.sock = null;
    self.onopen = noop;
    self.onclose = noop;
    self.onmessage = noop;
    self.onerror = noop;
    var defaults = {
            logPrefix: "[WSTransport]",
            chunderw: "chunderw-vpc-gll.twilio.com",
            reconnect: true,
            debug: false,
            secureSignaling: true,
            WebSocket: DefaultWebSocket
        };
    options = options || {};
    for (var prop in defaults) {
        if (prop in options) {
            continue;
        }
        options[prop] = defaults[prop];
    }
    self.options = options;
    self._WebSocket = options.WebSocket;
    log.mixinLog(self, self.options.logPrefix);
    self.log.enabled = self.options.debug;
    self.defaultReconnect = self.options.reconnect;
    var scheme = self.options.secureSignaling ? "wss://" : "ws://";
    self.uri = scheme + self.options.host + "/signal";
    return self;
}

WSTransport.prototype.msgQueue = [];

WSTransport.prototype.open = function(attempted) {
    this.log("Opening socket");
    if (this.sock && this.sock.readyState < 2) {
        this.log("Socket already open.");
        return;
    }
    this.options.reconnect = this.defaultReconnect;
    if (this.heartbeat) {
        this.heartbeat.onsleep = function() {};
    }
    this.heartbeat = new Heartbeat({
        interval: 15
    });
    this.sock = this._connect(attempted);
};

WSTransport.prototype.send = function(msg) {
    if (this.sock) {
        if (this.sock.readyState === 0) {
            this.msgQueue.push(msg);
            return;
        }
        try {
            this.sock.send(msg);
        } catch (error) {
            this.log("Error while sending. Closing socket: " + error.message);
            this.sock.close();
        }
    }
};

WSTransport.prototype.close = function() {
    this.log("Closing socket");
    this.options.reconnect = false;
    if (this.sock) {
        this.sock.close();
        this.sock = null;
    }
    if (this.heartbeat) {
        this.heartbeat.onsleep = function() {};
    }
};

WSTransport.prototype._cleanupSocket = function(socket) {
    if (socket) {
        this.log("Cleaning up socket");
        socket.onopen = function() {
            socket.close();
        };
        socket.onmessage = noop;
        socket.onerror = noop;
        socket.onclose = noop;
        if (socket.readyState < 2) {
            socket.close();
        }
    }
};

WSTransport.prototype._connect = function(attempted) {
    var attempt = ++attempted || 1;
    this.log("attempting to connect");
    var sock = null;
    try {
        sock = new this._WebSocket(this.uri);
    } catch (e) {
        this.onerror({
            code: 31e3,
            message: e.message || "Could not connect to " + this.uri
        });
        this.close();
        return null;
    }
    var self = this;
    var oldSocket = this.sock;
    var timeOpened = null;
    var connectTimeout = setTimeout(function() {
            self.log("connection attempt timed out");
            sock.onclose = function() {};
            sock.close();
            self.onclose();
            self._tryReconnect(attempt);
        }, 5e3);
    sock.onopen = function() {
        clearTimeout(connectTimeout);
        self._cleanupSocket(oldSocket);
        timeOpened = getTime();
        self.log("Socket opened");
        self.heartbeat.onsleep = function() {
            self.log("Heartbeat timed out. closing socket");
            self.sock.onclose = function() {};
            self.sock.close();
            self.onclose();
            self._tryReconnect(attempt);
        };
        self.heartbeat.beat();
        self.onopen();
        for (var i = 0; i < self.msgQueue.length; i++) {
            self.sock.send(self.msgQueue[i]);
        }
        self.msgQueue = [];
    };
    sock.onclose = function() {
        clearTimeout(connectTimeout);
        self._cleanupSocket(oldSocket);
        self.heartbeat.onsleep = function() {};
        if (timeOpened) {
            var socketDuration = (getTime() - timeOpened) / 1e3;
            if (socketDuration > 10) {
                attempt = 1;
            }
        }
        self.log("Socket closed");
        self.onclose();
        self._tryReconnect(attempt);
    };
    sock.onerror = function(e) {
        self.log("Socket received error: " + e.message);
        self.onerror({
            code: 31e3,
            message: e.message || "WSTransport socket error"
        });
    };
    sock.onmessage = function(message) {
        self.heartbeat.beat();
        if (message.data === "\n") {
            self.send("\n");
            return;
        }
        self.onmessage(message);
    };
    return sock;
};

WSTransport.prototype._tryReconnect = function(attempted) {
    attempted = attempted || 0;
    if (this.options.reconnect) {
        this.log("Attempting to reconnect.");
        var self = this;
        var backoff = 0;
        if (attempted < 5) {
            var minBackoff = 30;
            var backoffRange = Math.pow(2, attempted) * 50;
            backoff = minBackoff + Math.round(Math.random() * backoffRange);
        } else {
            backoff = 3e3;
        }
        setTimeout(function() {
            self.open(attempted);
        }, backoff);
    }
};

exports.WSTransport = WSTransport;