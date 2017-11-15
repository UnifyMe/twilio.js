"use strict";

var AudioPlayer = require("AudioPlayer");

function Sound(name, url, options) {
    if (!(this instanceof Sound)) {
        return new Sound(name, url, options);
    }
    if (!name || !url) {
        throw new Error("name and url are required arguments");
    }
    options = Object.assign({
        AudioFactory: typeof Audio !== "undefined" ? Audio : null,
        maxDuration: 0,
        shouldLoop: false
    }, options);
    options.AudioPlayer = options.audioContext ? AudioPlayer.bind(AudioPlayer, options.audioContext) : options.AudioFactory;
    Object.defineProperties(this, {
        _activeEls: {
            value: new Set()
        },
        _Audio: {
            value: options.AudioPlayer
        },
        _isSinkSupported: {
            value: options.AudioFactory !== null && typeof options.AudioFactory.prototype.setSinkId === "function"
        },
        _maxDuration: {
            value: options.maxDuration
        },
        _maxDurationTimeout: {
            value: null,
            writable: true
        },
        _playPromise: {
            value: null,
            writable: true
        },
        _shouldLoop: {
            value: options.shouldLoop
        },
        _sinkIds: {
            value: [ "default" ]
        },
        isPlaying: {
            enumerable: true,
            get: function() {
                return !!this._playPromise;
            }
        },
        name: {
            enumerable: true,
            value: name
        },
        url: {
            enumerable: true,
            value: url
        }
    });
    if (this._Audio) {
        preload(this._Audio, url);
    }
}

function preload(AudioFactory, url) {
    var el = new AudioFactory(url);
    el.preload = "auto";
    el.muted = true;
    el.play();
}

Sound.prototype.setSinkIds = function setSinkIds(ids) {
    if (!this._isSinkSupported) {
        return;
    }
    ids = ids.forEach ? ids : [ ids ];
    [].splice.apply(this._sinkIds, [ 0, this._sinkIds.length ].concat(ids));
};

Sound.prototype.stop = function stop() {
    this._activeEls.forEach(function(audioEl) {
        audioEl.pause();
        audioEl.src = "";
        audioEl.load();
    });
    this._activeEls.clear();
    clearTimeout(this._maxDurationTimeout);
    this._playPromise = null;
    this._maxDurationTimeout = null;
};

Sound.prototype.play = function play() {
    if (this.isPlaying) {
        this.stop();
    }
    if (this._maxDuration > 0) {
        this._maxDurationTimeout = setTimeout(this.stop.bind(this), this._maxDuration);
    }
    var self = this;
    var playPromise = this._playPromise = Promise.all(this._sinkIds.map(function createAudioElement(sinkId) {
            if (!self._Audio) {
                return Promise.resolve();
            }
            var audioElement = new self._Audio(self.url);
            audioElement.loop = self._shouldLoop;
            audioElement.addEventListener("ended", function() {
                self._activeEls.delete(audioElement);
            });
            return new Promise(function(resolve) {
                audioElement.addEventListener("canplaythrough", resolve);
            }).then(function() {
                if (!self.isPlaying || self._playPromise !== playPromise) {
                    return Promise.resolve();
                }
                return (self._isSinkSupported ? audioElement.setSinkId(sinkId) : Promise.resolve()).then(function setSinkIdSuccess() {
                    self._activeEls.add(audioElement);
                    return audioElement.play();
                }).then(function playSuccess() {
                    return audioElement;
                }, function playFailure(reason) {
                    self._activeEls.delete(audioElement);
                    throw reason;
                });
            });
        }));
    return playPromise;
};

module.exports = Sound;