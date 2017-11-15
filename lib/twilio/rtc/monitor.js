"use strict";

var EventEmitter = require("events").EventEmitter;

var getStatistics = require("./stats");

var inherits = require("util").inherits;

var Mos = require("./mos");

var SAMPLE_COUNT_METRICS = 5;

var SAMPLE_COUNT_CLEAR = 0;

var SAMPLE_COUNT_RAISE = 3;

var SAMPLE_INTERVAL = 1e3;

var WARNING_TIMEOUT = 5 * 1e3;

var DEFAULT_THRESHOLDS = {
        audioInputLevel: {
            maxDuration: 10
        },
        audioOutputLevel: {
            maxDuration: 10
        },
        packetsLostFraction: {
            max: 1
        },
        jitter: {
            max: 30
        },
        rtt: {
            max: 400
        },
        mos: {
            min: 3
        }
    };

function RTCMonitor(options) {
    if (!(this instanceof RTCMonitor)) {
        return new RTCMonitor(options);
    }
    options = options || {};
    var thresholds = Object.assign({}, DEFAULT_THRESHOLDS, options.thresholds);
    Object.defineProperties(this, {
        _activeWarnings: {
            value: new Map()
        },
        _currentStreaks: {
            value: new Map()
        },
        _peerConnection: {
            value: options.peerConnection,
            writable: true
        },
        _sampleBuffer: {
            value: []
        },
        _sampleInterval: {
            value: null,
            writable: true
        },
        _thresholds: {
            value: thresholds
        },
        _warningsEnabled: {
            value: true,
            writable: true
        }
    });
    if (options.peerConnection) {
        this.enable();
    }
    EventEmitter.call(this);
}

inherits(RTCMonitor, EventEmitter);

RTCMonitor.createSample = function createSample(stats, previousSample) {
    var previousPacketsSent = previousSample && previousSample.totals.packetsSent || 0;
    var previousPacketsReceived = previousSample && previousSample.totals.packetsReceived || 0;
    var previousPacketsLost = previousSample && previousSample.totals.packetsLost || 0;
    var currentPacketsSent = stats.packetsSent - previousPacketsSent;
    var currentPacketsReceived = stats.packetsReceived - previousPacketsReceived;
    var currentPacketsLost = stats.packetsLost - previousPacketsLost;
    var currentInboundPackets = currentPacketsReceived + currentPacketsLost;
    var currentPacketsLostFraction = currentInboundPackets > 0 ? currentPacketsLost / currentInboundPackets * 100 : 0;
    var totalInboundPackets = stats.packetsReceived + stats.packetsLost;
    var totalPacketsLostFraction = totalInboundPackets > 0 ? stats.packetsLost / totalInboundPackets * 100 : 100;
    return {
        timestamp: stats.timestamp,
        totals: {
            packetsReceived: stats.packetsReceived,
            packetsLost: stats.packetsLost,
            packetsSent: stats.packetsSent,
            packetsLostFraction: totalPacketsLostFraction,
            bytesReceived: stats.bytesReceived,
            bytesSent: stats.bytesSent
        },
        packetsSent: currentPacketsSent,
        packetsReceived: currentPacketsReceived,
        packetsLost: currentPacketsLost,
        packetsLostFraction: currentPacketsLostFraction,
        audioInputLevel: stats.audioInputLevel,
        audioOutputLevel: stats.audioOutputLevel,
        jitter: stats.jitter,
        rtt: stats.rtt,
        mos: Mos.calculate(stats, previousSample && currentPacketsLostFraction)
    };
};

RTCMonitor.prototype.enable = function enable(peerConnection) {
    if (peerConnection) {
        if (this._peerConnection && peerConnection !== this._peerConnection) {
            throw new Error("Attempted to replace an existing PeerConnection in RTCMonitor.enable");
        }
        this._peerConnection = peerConnection;
    }
    if (!this._peerConnection) {
        throw new Error("Can not enable RTCMonitor without a PeerConnection");
    }
    this._sampleInterval = this._sampleInterval || setInterval(this._fetchSample.bind(this), SAMPLE_INTERVAL);
    return this;
};

RTCMonitor.prototype.disable = function disable() {
    clearInterval(this._sampleInterval);
    this._sampleInterval = null;
    return this;
};

RTCMonitor.prototype.getSample = function getSample() {
    var pc = this._peerConnection;
    var self = this;
    return getStatistics(pc).then(function(stats) {
        var previousSample = self._sampleBuffer.length && self._sampleBuffer[self._sampleBuffer.length - 1];
        return RTCMonitor.createSample(stats, previousSample);
    });
};

RTCMonitor.prototype._fetchSample = function _fetchSample() {
    var self = this;
    return this.getSample().then(function addSample(sample) {
        self._addSample(sample);
        self._raiseWarnings();
        self.emit("sample", sample);
        return sample;
    }, function getSampleFailed(error) {
        self.disable();
        self.emit("error", error);
    });
};

RTCMonitor.prototype._addSample = function _addSample(sample) {
    var samples = this._sampleBuffer;
    samples.push(sample);
    if (samples.length > SAMPLE_COUNT_METRICS) {
        samples.splice(0, samples.length - SAMPLE_COUNT_METRICS);
    }
};

RTCMonitor.prototype._raiseWarnings = function _raiseWarnings() {
    if (!this._warningsEnabled) {
        return;
    }
    for (var name in this._thresholds) {
        this._raiseWarningsForStat(name);
    }
};

RTCMonitor.prototype.enableWarnings = function enableWarnings() {
    this._warningsEnabled = true;
    return this;
};

RTCMonitor.prototype.disableWarnings = function disableWarnings() {
    if (this._warningsEnabled) {
        this._activeWarnings.clear();
    }
    this._warningsEnabled = false;
    return this;
};

RTCMonitor.prototype._raiseWarningsForStat = function _raiseWarningsForStat(statName) {
    var samples = this._sampleBuffer;
    var limits = this._thresholds[statName];
    var relevantSamples = samples.slice(-SAMPLE_COUNT_METRICS);
    var values = relevantSamples.map(function(sample) {
            return sample[statName];
        });
    var containsNull = values.some(function(value) {
            return typeof value === "undefined" || value === null;
        });
    if (containsNull) {
        return;
    }
    var count;
    if (typeof limits.max === "number") {
        count = countHigh(limits.max, values);
        if (count >= SAMPLE_COUNT_RAISE) {
            this._raiseWarning(statName, "max", {
                values: values
            });
        } else if (count <= SAMPLE_COUNT_CLEAR) {
            this._clearWarning(statName, "max", {
                values: values
            });
        }
    }
    if (typeof limits.min === "number") {
        count = countLow(limits.min, values);
        if (count >= SAMPLE_COUNT_RAISE) {
            this._raiseWarning(statName, "min", {
                values: values
            });
        } else if (count <= SAMPLE_COUNT_CLEAR) {
            this._clearWarning(statName, "min", {
                values: values
            });
        }
    }
    if (typeof limits.maxDuration === "number" && samples.length > 1) {
        relevantSamples = samples.slice(-2);
        var prevValue = relevantSamples[0][statName];
        var curValue = relevantSamples[1][statName];
        var prevStreak = this._currentStreaks.get(statName) || 0;
        var streak = prevValue === curValue ? prevStreak + 1 : 0;
        this._currentStreaks.set(statName, streak);
        if (streak >= limits.maxDuration) {
            this._raiseWarning(statName, "maxDuration", {
                value: streak
            });
        } else if (streak === 0) {
            this._clearWarning(statName, "maxDuration", {
                value: prevStreak
            });
        }
    }
};

function countLow(min, values) {
    return values.reduce(function(lowCount, value) {
        return lowCount += value < min ? 1 : 0;
    }, 0);
}

function countHigh(max, values) {
    return values.reduce(function(highCount, value) {
        return highCount += value > max ? 1 : 0;
    }, 0);
}

RTCMonitor.prototype._clearWarning = function _clearWarning(statName, thresholdName, data) {
    var warningId = statName + ":" + thresholdName;
    var activeWarning = this._activeWarnings.get(warningId);
    if (!activeWarning || Date.now() - activeWarning.timeRaised < WARNING_TIMEOUT) {
        return;
    }
    this._activeWarnings.delete(warningId);
    this.emit("warning-cleared", Object.assign({
        name: statName,
        threshold: {
            name: thresholdName,
            value: this._thresholds[statName][thresholdName]
        }
    }, data));
};

RTCMonitor.prototype._raiseWarning = function _raiseWarning(statName, thresholdName, data) {
    var warningId = statName + ":" + thresholdName;
    if (this._activeWarnings.has(warningId)) {
        return;
    }
    this._activeWarnings.set(warningId, {
        timeRaised: Date.now()
    });
    this.emit("warning", Object.assign({
        name: statName,
        threshold: {
            name: thresholdName,
            value: this._thresholds[statName][thresholdName]
        }
    }, data));
};

module.exports = RTCMonitor;