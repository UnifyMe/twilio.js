"use strict";

var request = require("./request");

function EventPublisher(productName, token, options) {
    if (!(this instanceof EventPublisher)) {
        return new EventPublisher(productName, token, options);
    }
    options = Object.assign({
        defaultPayload: function() {
            return {};
        },
        host: "eventgw.twilio.com"
    }, options);
    var defaultPayload = options.defaultPayload;
    if (typeof defaultPayload !== "function") {
        defaultPayload = function() {
            return Object.assign({}, options.defaultPayload);
        };
    }
    var isEnabled = true;
    Object.defineProperties(this, {
        _defaultPayload: {
            value: defaultPayload
        },
        _isEnabled: {
            get: function() {
                return isEnabled;
            },
            set: function(_isEnabled) {
                isEnabled = _isEnabled;
            }
        },
        _host: {
            value: options.host
        },
        _request: {
            value: options.request || request
        },
        _token: {
            value: token,
            writable: true
        },
        isEnabled: {
            enumerable: true,
            get: function() {
                return isEnabled;
            }
        },
        productName: {
            enumerable: true,
            value: productName
        },
        token: {
            enumerable: true,
            get: function() {
                return this._token;
            }
        }
    });
}

EventPublisher.prototype._post = function _post(endpointName, level, group, name, payload, connection, force) {
    if (!this.isEnabled && !force) {
        return Promise.resolve();
    }
    var event = {
            publisher: this.productName,
            group: group,
            name: name,
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            payload_type: "application/json",
            private: false,
            payload: payload && payload.forEach ? payload.slice(0) : Object.assign(this._defaultPayload(connection), payload)
        };
    var requestParams = {
            url: "https://" + this._host + "/v2/" + endpointName,
            body: event,
            headers: {
                "Content-Type": "application/json",
                "X-Twilio-Token": this.token
            }
        };
    var self = this;
    return new Promise(function(resolve, reject) {
        self._request.post(requestParams, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

EventPublisher.prototype.post = function post(level, group, name, payload, connection, force) {
    return this._post("EndpointEvents", level, group, name, payload, connection, force);
};

EventPublisher.prototype.debug = function debug(group, name, payload, connection) {
    return this.post("debug", group, name, payload, connection);
};

EventPublisher.prototype.info = function info(group, name, payload, connection) {
    return this.post("info", group, name, payload, connection);
};

EventPublisher.prototype.warn = function warn(group, name, payload, connection) {
    return this.post("warning", group, name, payload, connection);
};

EventPublisher.prototype.error = function error(group, name, payload, connection) {
    return this.post("error", group, name, payload, connection);
};

EventPublisher.prototype.postMetrics = function postMetrics(group, name, metrics, customFields) {
    var samples = metrics.map(formatMetric).map(function(sample) {
            return Object.assign(sample, customFields);
        });
    return this._post("EndpointMetrics", "info", group, name, samples);
};

EventPublisher.prototype.setToken = function setToken(token) {
    this._token = token;
};

EventPublisher.prototype.enable = function enable() {
    this._isEnabled = true;
};

EventPublisher.prototype.disable = function disable() {
    this._isEnabled = false;
};

function formatMetric(sample) {
    return {
        timestamp: new Date(sample.timestamp).toISOString(),
        total_packets_received: sample.totals.packetsReceived,
        total_packets_lost: sample.totals.packetsLost,
        total_packets_sent: sample.totals.packetsSent,
        total_bytes_received: sample.totals.bytesReceived,
        total_bytes_sent: sample.totals.bytesSent,
        packets_received: sample.packetsReceived,
        packets_lost: sample.packetsLost,
        packets_lost_fraction: sample.packetsLostFraction && Math.round(sample.packetsLostFraction * 100) / 100,
        audio_level_in: sample.audioInputLevel,
        audio_level_out: sample.audioOutputLevel,
        call_volume_input: sample.inputVolume,
        call_volume_output: sample.outputVolume,
        jitter: sample.jitter,
        rtt: sample.rtt,
        mos: sample.mos && Math.round(sample.mos * 100) / 100
    };
}

module.exports = EventPublisher;