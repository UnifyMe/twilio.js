/*! twilio-client.js 1.4.30

The following license applies to all parts of this software except as
documented below.

    Copyright 2015 Twilio, inc.
 
    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at
 
        http://www.apache.org/licenses/LICENSE-2.0
 
    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

This software includes rtcpeerconnection-shim under the following (BSD 3-Clause) license.

    Copyright (c) 2017 Philipp Hancke. All rights reserved.

    Copyright (c) 2014, The WebRTC project authors. All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are
    met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.

      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in
        the documentation and/or other materials provided with the
        distribution.

      * Neither the name of Philipp Hancke nor the names of its contributors may
        be used to endorse or promote products derived from this software
        without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
    HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

 */
/* eslint-disable */
(function(root) {
  var bundle = (function(){function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s}return e})()({1:[function(require,module,exports){
'use strict';
module.exports = WebSocket;

},{}],2:[function(require,module,exports){
'use strict';
module.exports = { XMLHttpRequest: XMLHttpRequest };

},{}],3:[function(require,module,exports){
'use strict';

exports.Device = require('./twilio/device').Device;
exports.PStream = require('./twilio/pstream').PStream;
exports.Connection = require('./twilio/connection').Connection;
},{"./twilio/connection":5,"./twilio/device":6,"./twilio/pstream":12}],4:[function(require,module,exports){
'use strict';

var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var log = require('./log');
var MediaDeviceInfoShim = require('./shims/mediadeviceinfo');
var defaultMediaDevices = require('./shims/mediadevices');
var OutputDeviceCollection = require('./outputdevicecollection');
var util = require('./util');

/**
 * @class
 * @property {Map<string deviceId, MediaDeviceInfo device>} availableInputDevices - A
 *   Map of all audio input devices currently available to the browser.
 * @property {Map<string deviceId, MediaDeviceInfo device>} availableOutputDevices - A
 *   Map of all audio output devices currently available to the browser.
 * @property {MediaDeviceInfo} inputDevice - The active input device. This will not
 *   initially be populated. Having no inputDevice specified by setInputDevice()
 *   will disable input selection related functionality.
 * @property {boolean} isOutputSelectionSupported - False if the browser does not support
 *   setSinkId or enumerateDevices and Twilio can not facilitate output selection
 *   functionality.
 * @property {boolean} isVolumeSupported - False if the browser does not support
 *   AudioContext and Twilio can not analyse the volume in real-time.
 * @property {OutputDeviceCollection} speakerDevices - The current set of output
 *   devices that call audio ([voice, outgoing, disconnect, dtmf]) is routed through.
 *   These are the sounds that are initiated by the user, or played while the user
 *   is otherwise present at the endpoint. If all specified devices are lost,
 *   this Set will revert to contain only the "default" device.
 * @property {OutputDeviceCollection} ringtoneDevices - The current set of output
 *   devices that incoming ringtone audio is routed through. These are the sounds that
 *   may play while the user is away from the machine or not wearing their
 *   headset. It is important that this audio is heard. If all specified
 *   devices lost, this Set will revert to contain only the "default" device.
 * @fires AudioHelper#deviceChange
 */
function AudioHelper(onActiveOutputsChanged, onActiveInputChanged, getUserMedia, options) {
  if (!(this instanceof AudioHelper)) {
    return new AudioHelper(onActiveOutputsChanged, onActiveInputChanged, getUserMedia, options);
  }

  EventEmitter.call(this);

  options = Object.assign({
    AudioContext: typeof AudioContext !== 'undefined' && AudioContext,
    mediaDevices: defaultMediaDevices,
    setSinkId: typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype.setSinkId
  }, options);

  log.mixinLog(this, '[AudioHelper]');
  this.log.enabled = options.logEnabled;
  this.log.warnings = options.logWarnings;

  var availableInputDevices = new Map();
  var availableOutputDevices = new Map();

  var isAudioContextSupported = !!(options.AudioContext || options.audioContext);

  var mediaDevices = options.mediaDevices;
  var isEnumerationSupported = mediaDevices && mediaDevices.enumerateDevices || false;
  var isSetSinkSupported = typeof options.setSinkId === 'function';
  var isOutputSelectionSupported = isEnumerationSupported && isSetSinkSupported;
  var isVolumeSupported = isAudioContextSupported;

  if (options.soundOptions) {
    addOptionsToAudioHelper(this, options.soundOptions);
  }

  var audioContext = null;
  var inputVolumeAnalyser = null;
  if (isVolumeSupported) {
    audioContext = options.audioContext || new options.AudioContext();
    inputVolumeAnalyser = audioContext.createAnalyser();
    inputVolumeAnalyser.fftSize = 32;
    inputVolumeAnalyser.smoothingTimeConstant = 0.3;
  }

  var self = this;
  Object.defineProperties(this, {
    _audioContext: {
      value: audioContext
    },
    _getUserMedia: {
      value: getUserMedia
    },
    _inputDevice: {
      value: null,
      writable: true
    },
    _inputStream: {
      value: null,
      writable: true
    },
    _inputVolumeAnalyser: {
      value: inputVolumeAnalyser
    },
    _isPollingInputVolume: {
      value: false,
      writable: true
    },
    _onActiveInputChanged: {
      value: onActiveInputChanged
    },
    _mediaDevices: {
      value: mediaDevices
    },
    _unknownDeviceIndexes: {
      value: {}
    },
    _updateAvailableDevices: {
      value: updateAvailableDevices.bind(null, this)
    },
    availableInputDevices: {
      enumerable: true,
      value: availableInputDevices
    },
    availableOutputDevices: {
      enumerable: true,
      value: availableOutputDevices
    },
    inputDevice: {
      enumerable: true,
      get: function get() {
        return self._inputDevice;
      }
    },
    inputStream: {
      enumerable: true,
      get: function get() {
        return self._inputStream;
      }
    },
    isVolumeSupported: {
      enumerable: true,
      value: isVolumeSupported
    },
    isOutputSelectionSupported: {
      enumerable: true,
      value: isOutputSelectionSupported
    },
    ringtoneDevices: {
      enumerable: true,
      value: new OutputDeviceCollection('ringtone', availableOutputDevices, onActiveOutputsChanged, isOutputSelectionSupported)
    },
    speakerDevices: {
      enumerable: true,
      value: new OutputDeviceCollection('speaker', availableOutputDevices, onActiveOutputsChanged, isOutputSelectionSupported)
    }
  });

  this.on('newListener', function (eventName) {
    if (eventName === 'inputVolume') {
      self._maybeStartPollingVolume();
    }
  });

  this.on('removeListener', function (eventName) {
    if (eventName === 'inputVolume') {
      self._maybeStopPollingVolume();
    }
  });

  this.once('newListener', function () {
    // NOTE (rrowland): Ideally we would only check isEnumerationSupported here, but
    //   in at least one browser version (Tested in FF48) enumerateDevices actually
    //   returns bad data for the listed devices. Instead, we check for
    //   isOutputSelectionSupported to avoid these quirks that may negatively affect customers.
    if (!isOutputSelectionSupported) {
      // eslint-disable-next-line no-console
      console.warn('Warning: This browser does not support audio output selection.');
    }

    if (!isVolumeSupported) {
      // eslint-disable-next-line no-console
      console.warn('Warning: This browser does not support Twilio\'s volume indicator feature.');
    }
  });

  if (isEnumerationSupported) {
    initializeEnumeration(this);
  }
}

function initializeEnumeration(audio) {
  audio._mediaDevices.addEventListener('devicechange', audio._updateAvailableDevices);
  audio._mediaDevices.addEventListener('deviceinfochange', audio._updateAvailableDevices);

  updateAvailableDevices(audio).then(function () {
    if (!audio.isOutputSelectionSupported) {
      return;
    }

    Promise.all([audio.speakerDevices.set('default'), audio.ringtoneDevices.set('default')]).catch(function (reason) {
      audio.log.warn('Warning: Unable to set audio output devices. ' + reason);
    });
  });
}

inherits(AudioHelper, EventEmitter);

AudioHelper.prototype._maybeStartPollingVolume = function _maybeStartPollingVolume() {
  if (!this.isVolumeSupported || !this._inputStream) {
    return;
  }

  updateVolumeSource(this);

  if (this._isPollingInputVolume) {
    return;
  }

  var bufferLength = this._inputVolumeAnalyser.frequencyBinCount;
  var buffer = new Uint8Array(bufferLength);

  var self = this;
  this._isPollingInputVolume = true;
  requestAnimationFrame(function emitVolume() {
    if (!self._isPollingInputVolume) {
      return;
    }

    self._inputVolumeAnalyser.getByteFrequencyData(buffer);
    var inputVolume = util.average(buffer);

    self.emit('inputVolume', inputVolume / 255);
    requestAnimationFrame(emitVolume);
  });
};

AudioHelper.prototype._maybeStopPollingVolume = function _maybeStopPollingVolume() {
  if (!this.isVolumeSupported) {
    return;
  }

  if (!this._isPollingInputVolume || this._inputStream && this.listenerCount('inputVolume')) {
    return;
  }

  if (this._inputVolumeSource) {
    this._inputVolumeSource.disconnect();
    this._inputVolumeSource = null;
  }

  this._isPollingInputVolume = false;
};

/**
 * Replace the current input device with a new device by ID.
 * @param {string} deviceId - An ID of a device to replace the existing
 *   input device with.
 * @returns {Promise} - Rejects if the ID is not found, setting the input device
 *   fails, or an ID is not passed.
 */
AudioHelper.prototype.setInputDevice = function setInputDevice(deviceId) {
  if (util.isFirefox()) {
    return Promise.reject(new Error('Firefox does not currently support opening multiple ' + 'audio input tracks simultaneously, even across different tabs. As a result, ' + 'Device.audio.setInputDevice is disabled on Firefox until support is added.\n' + 'Related BugZilla thread: https://bugzilla.mozilla.org/show_bug.cgi?id=1299324'));
  }

  return this._setInputDevice(deviceId, false);
};

/**
 * Replace the current input device with a new device by ID.
 * @private
 * @param {string} deviceId - An ID of a device to replace the existing
 *   input device with.
 * @param {boolean} forceGetUserMedia - If true, getUserMedia will be called even if
 *   the specified device is already active.
 * @returns {Promise} - Rejects if the ID is not found, setting the input device
 *   fails, or an ID is not passed.
 */
AudioHelper.prototype._setInputDevice = function _setInputDevice(deviceId, forceGetUserMedia) {
  if (typeof deviceId !== 'string') {
    return Promise.reject(new Error('Must specify the device to set'));
  }

  var device = this.availableInputDevices.get(deviceId);
  if (!device) {
    return Promise.reject(new Error('Device not found: ' + deviceId));
  }

  if (this._inputDevice && this._inputDevice.deviceId === deviceId && this._inputStream) {
    if (!forceGetUserMedia) {
      return Promise.resolve();
    }

    // If the currently active track is still in readyState `live`, gUM may return the same track
    // rather than returning a fresh track.
    this._inputStream.getTracks().forEach(function (track) {
      track.stop();
    });
  }

  var self = this;
  return this._getUserMedia({
    audio: { deviceId: { exact: deviceId } }
  }).then(function onGetUserMediaSuccess(stream) {
    return self._onActiveInputChanged(stream).then(function () {
      replaceStream(self, stream);
      self._inputDevice = device;
      self._maybeStartPollingVolume();
    });
  });
};

/**
 * Unset the input device, stopping the tracks. This should only be called when not in a connection, and
 *   will not allow removal of the input device during a live call.
 * @returns {Promise} Rejects if the input device is currently in use by a connection.
 */
AudioHelper.prototype.unsetInputDevice = function unsetInputDevice() {
  if (!this.inputDevice) {
    return Promise.resolve();
  }

  var self = this;
  return this._onActiveInputChanged(null).then(function () {
    replaceStream(self, null);
    self._inputDevice = null;
    self._maybeStopPollingVolume();
  });
};

/**
 * Unbind the listeners from mediaDevices.
 * @private
 */
AudioHelper.prototype._unbind = function _unbind() {
  this._mediaDevices.removeEventListener('devicechange', this._updateAvailableDevices);
  this._mediaDevices.removeEventListener('deviceinfochange', this._updateAvailableDevices);
};

/**
 * @event AudioHelper#deviceChange
 * Fired when the list of available devices has changed.
 * @param {Array<MediaDeviceInfo>} lostActiveDevices - An array of all currently-active
 *   devices that were removed with this device change. An empty array if the current
 *   active devices remain unchanged. A non-empty array is an indicator that the user
 *   experience has likely been impacted.
 */

/**
 * Merge the passed Options into AudioHelper. Currently used to merge the deprecated
 *   <Options>Device.sounds object onto the new AudioHelper interface.
 * @param {AudioHelper} audioHelper - The AudioHelper instance to merge the Options
 *   onto.
 * @param {Options} options - The Twilio Options object to merge.
 * @private
 */
function addOptionsToAudioHelper(audioHelper, options) {
  var dictionary = options.__dict__;
  if (!dictionary) {
    return;
  }

  function setValue(key, value) {
    if (typeof value !== 'undefined') {
      dictionary[key] = value;
    }

    return dictionary[key];
  }

  Object.keys(dictionary).forEach(function (key) {
    audioHelper[key] = setValue.bind(null, key);
  });
}

/**
 * Update the available input and output devices
 * @param {AudioHelper} audio
 * @returns {Promise}
 * @private
 */
function updateAvailableDevices(audio) {
  return audio._mediaDevices.enumerateDevices().then(function (devices) {
    updateDevices(audio, filterByKind(devices, 'audiooutput'), audio.availableOutputDevices, removeLostOutput);

    updateDevices(audio, filterByKind(devices, 'audioinput'), audio.availableInputDevices, removeLostInput);

    var defaultDevice = audio.availableOutputDevices.get('default') || Array.from(audio.availableOutputDevices.values())[0];

    [audio.speakerDevices, audio.ringtoneDevices].forEach(function (outputDevices) {
      if (!outputDevices.get().size && audio.availableOutputDevices.size) {
        outputDevices.set(defaultDevice.deviceId);
      }
    });
  });
}

/**
 * Remove an input device from outputs
 * @param {AudioHelper} audio
 * @param {MediaDeviceInfoShim} lostDevice
 * @returns {boolean} wasActive
 * @private
 */
function removeLostOutput(audio, lostDevice) {
  return audio.speakerDevices._delete(lostDevice) | audio.ringtoneDevices._delete(lostDevice);
}

/**
 * Remove an input device from inputs
 * @param {AudioHelper} audio
 * @param {MediaDeviceInfoShim} lostDevice
 * @returns {boolean} wasActive
 * @private
 */
function removeLostInput(audio, lostDevice) {
  if (!audio.inputDevice || audio.inputDevice.deviceId !== lostDevice.deviceId) {
    return false;
  }

  replaceStream(audio, null);
  audio._inputDevice = null;
  audio._maybeStopPollingVolume();

  var defaultDevice = audio.availableInputDevices.get('default') || Array.from(audio.availableInputDevices.values())[0];

  if (defaultDevice) {
    audio.setInputDevice(defaultDevice.deviceId);
  }

  return true;
}

function filterByKind(devices, kind) {
  return devices.filter(function (device) {
    return device.kind === kind;
  });
}

function getDeviceId(device) {
  return device.deviceId;
}

function updateDevices(audio, updatedDevices, availableDevices, removeLostDevice) {
  var updatedDeviceIds = updatedDevices.map(getDeviceId);
  var knownDeviceIds = Array.from(availableDevices.values()).map(getDeviceId);
  var lostActiveDevices = [];

  // Remove lost devices
  var lostDeviceIds = util.difference(knownDeviceIds, updatedDeviceIds);
  lostDeviceIds.forEach(function (lostDeviceId) {
    var lostDevice = availableDevices.get(lostDeviceId);
    availableDevices.delete(lostDeviceId);
    if (removeLostDevice(audio, lostDevice)) {
      lostActiveDevices.push(lostDevice);
    }
  });

  // Add any new devices, or devices with updated labels
  var deviceChanged = false;
  updatedDevices.forEach(function (newDevice) {
    var existingDevice = availableDevices.get(newDevice.deviceId);
    var newMediaDeviceInfo = wrapMediaDeviceInfo(audio, newDevice);

    if (!existingDevice || existingDevice.label !== newMediaDeviceInfo.label) {
      availableDevices.set(newDevice.deviceId, newMediaDeviceInfo);
      deviceChanged = true;
    }
  });

  if (deviceChanged || lostDeviceIds.length) {
    // Force a new gUM in case the underlying tracks of the active stream have changed. One
    //   reason this might happen is when `default` is selected and set to a USB device,
    //   then that device is unplugged or plugged back in. We can't check for the 'ended'
    //   event or readyState because it is asynchronous and may take upwards of 5 seconds,
    //   in my testing. (rrowland)
    if (audio.inputDevice !== null && audio.inputDevice.deviceId === 'default') {
      audio.log.warn(['Calling getUserMedia after device change to ensure that the', 'tracks of the active device (default) have not gone stale.'].join(' '));
      audio._setInputDevice(audio._inputDevice.deviceId, true);
    }

    audio.emit('deviceChange', lostActiveDevices);
  }
}

var kindAliases = {
  audiooutput: 'Audio Output',
  audioinput: 'Audio Input'
};

function getUnknownDeviceIndex(audioHelper, mediaDeviceInfo) {
  var id = mediaDeviceInfo.deviceId;
  var kind = mediaDeviceInfo.kind;
  var unknownIndexes = audioHelper._unknownDeviceIndexes;

  if (!unknownIndexes[kind]) {
    unknownIndexes[kind] = {};
  }

  var index = unknownIndexes[kind][id];
  if (!index) {
    index = Object.keys(unknownIndexes[kind]).length + 1;
    unknownIndexes[kind][id] = index;
  }

  return index;
}

function wrapMediaDeviceInfo(audioHelper, mediaDeviceInfo) {
  var options = {
    deviceId: mediaDeviceInfo.deviceId,
    groupId: mediaDeviceInfo.groupId,
    kind: mediaDeviceInfo.kind,
    label: mediaDeviceInfo.label
  };

  if (!options.label) {
    if (options.deviceId === 'default') {
      options.label = 'Default';
    } else {
      var index = getUnknownDeviceIndex(audioHelper, mediaDeviceInfo);
      options.label = 'Unknown ' + kindAliases[options.kind] + ' Device ' + index;
    }
  }

  return new MediaDeviceInfoShim(options);
}

function updateVolumeSource(audioHelper) {
  if (audioHelper._inputVolumeSource) {
    audioHelper._inputVolumeSource.disconnect();
    audioHelper._inputVolumeSource = null;
  }

  audioHelper._inputVolumeSource = audioHelper._audioContext.createMediaStreamSource(audioHelper._inputStream);
  audioHelper._inputVolumeSource.connect(audioHelper._inputVolumeAnalyser);
}

function replaceStream(audio, stream) {
  if (audio._inputStream) {
    audio._inputStream.getTracks().forEach(function (track) {
      track.stop();
    });
  }

  audio._inputStream = stream;
}

module.exports = AudioHelper;
},{"./log":9,"./outputdevicecollection":11,"./shims/mediadeviceinfo":23,"./shims/mediadevices":24,"./util":28,"events":37,"util":46}],5:[function(require,module,exports){
'use strict';

var EventEmitter = require('events').EventEmitter;
var Exception = require('./util').Exception;
var log = require('./log');
var rtc = require('./rtc');
var RTCMonitor = require('./rtc/monitor');
var twutil = require('./util');
var util = require('util');

var DTMF_INTER_TONE_GAP = 70;
var DTMF_PAUSE_DURATION = 500;
var DTMF_TONE_DURATION = 160;

var METRICS_BATCH_SIZE = 10;
var SAMPLES_TO_IGNORE = 20;

var FEEDBACK_SCORES = [1, 2, 3, 4, 5];
var FEEDBACK_ISSUES = ['one-way-audio', 'choppy-audio', 'dropped-call', 'audio-latency', 'noisy-call', 'echo'];

var WARNING_NAMES = {
  audioOutputLevel: 'audio-output-level',
  audioInputLevel: 'audio-input-level',
  packetsLostFraction: 'packet-loss',
  jitter: 'jitter',
  rtt: 'rtt',
  mos: 'mos'
};

var WARNING_PREFIXES = {
  min: 'low-',
  max: 'high-',
  maxDuration: 'constant-'
};

/**
 * Constructor for Connections.
 *
 * @exports Connection as Twilio.Connection
 * @memberOf Twilio
 * @borrows EventEmitter#addListener as #addListener
 * @borrows EventEmitter#emit as #emit
 * @borrows EventEmitter#removeListener as #removeListener
 * @borrows EventEmitter#hasListener as #hasListener
 * @borrows Twilio.mixinLog-log as #log
 * @constructor
 * @param {object} device The device associated with this connection
 * @param {object} message Data to send over the connection
 * @param {Connection.Options} [options]
 */ /**
    * @typedef {Object} Connection.Options
    * @property {string} [chunder='chunder.prod.twilio.com'] Hostname of chunder server
    * @property {boolean} [debug=false] Enable debugging
    * @property {MediaStream} [MediaStream] Use this MediaStream object
    * @property {string} [token] The Twilio capabilities JWT
    * @property {function<MediaStream>} [getInputStream] A function returning an input stream to use when
    *   setting up the PeerConnection object when Connection#accept is called.
    * @property {function<Array<string>>} [getSinkIds] A function returning an array of sink IDs to use when
    *   setting up the PeerConnection object when Connection#accept is called.
    * @property {string} [callParameters] The call parameters, if this is an incoming
    *   connection.
    */
function Connection(device, message, getUserMedia, options) {
  if (!(this instanceof Connection)) {
    return new Connection(device, message, getUserMedia, options);
  }

  var self = this;

  twutil.monitorEventEmitter('Twilio.Connection', this);
  this._soundcache = device.soundcache;
  this.message = message || {};
  this.customParameters = new Map(Object.entries(this.message));

  // (rrowland) Lint: This constructor should not be lower case, but if we don't support
  //   the prior name we may break something.
  var DefaultMediaStream = options.mediaStreamFactory || device.options.MediaStream || device.options.mediaStreamFactory || rtc.PeerConnection;

  options = this.options = Object.assign({
    audioConstraints: device.options.audioConstraints,
    callParameters: {},
    debug: false,
    iceServers: device.options.iceServers,
    logPrefix: '[Connection]',
    MediaStream: DefaultMediaStream,
    offerSdp: null,
    rtcConstraints: device.options.rtcConstraints
  }, options);

  this.parameters = options.callParameters;
  this._status = 'pending';
  this._isAnswered = false;
  this._direction = this.parameters.CallSid ? 'INCOMING' : 'OUTGOING';

  this.sendHangup = true;
  log.mixinLog(this, this.options.logPrefix);
  this.log.enabled = this.options.debug;
  this.log.warnings = this.options.warnings;

  // These are event listeners we need to remove from PStream.
  function noop() {}
  this._onCancel = noop;
  this._onHangup = noop;
  this._onAnswer = this._onAnswer.bind(this);
  this._onRinging = this._onRinging.bind(this);

  var publisher = this._publisher = options.publisher;

  if (this._direction === 'INCOMING') {
    publisher.info('connection', 'incoming', null, this);
  }

  var monitor = this._monitor = new RTCMonitor();

  // First 10 seconds or so are choppy, so let's not bother with these warnings.
  monitor.disableWarnings();

  var samples = [];

  function createMetricPayload() {
    var payload = {
      /* eslint-disable camelcase */
      call_sid: self.parameters.CallSid,
      client_name: device._clientName,
      sdk_version: twutil.getReleaseVersion(),
      selected_region: device.options.region
      /* eslint-enable camelcase */
    };

    if (device.stream) {
      if (device.stream.gateway) {
        payload.gateway = device.stream.gateway;
      }

      if (device.stream.region) {
        payload.region = device.stream.region;
      }
    }

    payload.direction = self._direction;

    return payload;
  }

  function publishMetrics() {
    if (samples.length === 0) {
      return;
    }

    publisher.postMetrics('quality-metrics-samples', 'metrics-sample', samples.splice(0), createMetricPayload()).catch(function (e) {
      self.log.warn('Unable to post metrics to Insights. Received error:', e);
    });
  }

  var samplesIgnored = 0;
  monitor.on('sample', function (sample) {
    // Enable warnings after we've ignored the an initial amount. This is to
    // avoid throwing false positive warnings initially.
    if (samplesIgnored < SAMPLES_TO_IGNORE) {
      samplesIgnored++;
    } else if (samplesIgnored === SAMPLES_TO_IGNORE) {
      monitor.enableWarnings();
    }

    sample.inputVolume = self._latestInputVolume;
    sample.outputVolume = self._latestOutputVolume;

    samples.push(sample);
    if (samples.length >= METRICS_BATCH_SIZE) {
      publishMetrics();
    }
  });

  function formatPayloadForEA(warningData) {
    var payloadData = { threshold: warningData.threshold.value };

    if (warningData.values) {
      payloadData.values = warningData.values.map(function (value) {
        if (typeof value === 'number') {
          return Math.round(value * 100) / 100;
        }

        return value;
      });
    } else if (warningData.value) {
      payloadData.value = warningData.value;
    }

    return { data: payloadData };
  }

  function reemitWarning(wasCleared, warningData) {
    var groupPrefix = /^audio/.test(warningData.name) ? 'audio-level-' : 'network-quality-';
    var groupSuffix = wasCleared ? '-cleared' : '-raised';
    var groupName = groupPrefix + 'warning' + groupSuffix;

    var warningPrefix = WARNING_PREFIXES[warningData.threshold.name];
    var warningName = warningPrefix + WARNING_NAMES[warningData.name];

    // Ignore constant input if the Connection is muted (Expected)
    if (warningName === 'constant-audio-input-level' && self.isMuted()) {
      return;
    }

    var level = wasCleared ? 'info' : 'warning';

    // Avoid throwing false positives as warnings until we refactor volume metrics
    if (warningName === 'constant-audio-output-level') {
      level = 'info';
    }

    publisher.post(level, groupName, warningName, formatPayloadForEA(warningData), self);

    if (warningName !== 'constant-audio-output-level') {
      var emitName = wasCleared ? 'warning-cleared' : 'warning';
      self.emit(emitName, warningName);
    }
  }

  monitor.on('warning-cleared', reemitWarning.bind(null, true));
  monitor.on('warning', reemitWarning.bind(null, false));

  /**
   * Reference to the Twilio.MediaStream object.
   * @type Twilio.MediaStream
   */
  this.mediaStream = new this.options.MediaStream(device, getUserMedia);

  this.on('volume', function (inputVolume, outputVolume) {
    self._latestInputVolume = inputVolume;
    self._latestOutputVolume = outputVolume;
  });

  this.mediaStream.onvolume = this.emit.bind(this, 'volume');

  this.mediaStream.oniceconnectionstatechange = function (state) {
    var level = state === 'failed' ? 'error' : 'debug';
    publisher.post(level, 'ice-connection-state', state, null, self);
  };

  this.mediaStream.onicegatheringstatechange = function (state) {
    publisher.debug('signaling-state', state, null, self);
  };

  this.mediaStream.onsignalingstatechange = function (state) {
    publisher.debug('signaling-state', state, null, self);
  };

  this.mediaStream.ondisconnect = function (msg) {
    self.log(msg);
    publisher.warn('network-quality-warning-raised', 'ice-connectivity-lost', {
      message: msg
    }, self);
    self.emit('warning', 'ice-connectivity-lost');
  };
  this.mediaStream.onreconnect = function (msg) {
    self.log(msg);
    publisher.info('network-quality-warning-cleared', 'ice-connectivity-lost', {
      message: msg
    }, self);
    self.emit('warning-cleared', 'ice-connectivity-lost');
  };
  this.mediaStream.onerror = function (e) {
    if (e.disconnect === true) {
      self._disconnect(e.info && e.info.message);
    }
    var error = {
      code: e.info.code,
      message: e.info.message || 'Error with mediastream',
      info: e.info,
      connection: self
    };

    self.log('Received an error from MediaStream:', e);
    self.emit('error', error);
  };

  this.mediaStream.onopen = function () {
    // NOTE(mroberts): While this may have been happening in previous
    // versions of Chrome, since Chrome 45 we have seen the
    // PeerConnection's onsignalingstatechange handler invoked multiple
    // times in the same signalingState 'stable'. When this happens, we
    // invoke this onopen function. If we invoke it twice without checking
    // for _status 'open', we'd accidentally close the PeerConnection.
    //
    // See <https://code.google.com/p/webrtc/issues/detail?id=4996>.
    if (self._status === 'open') {
      return;
    } else if (self._status === 'ringing' || self._status === 'connecting') {
      self.mute(false);
      self._maybeTransitionToOpen();
    } else {
      // call was probably canceled sometime before this
      self.mediaStream.close();
    }
  };

  this.mediaStream.onclose = function () {
    self._status = 'closed';
    if (device.sounds.__dict__.disconnect) {
      device.soundcache.get('disconnect').play();
    }

    monitor.disable();
    publishMetrics();

    self.emit('disconnect', self);
  };

  // temporary call sid to be used for outgoing calls
  this.outboundConnectionId = twutil.generateConnectionUUID();

  this.pstream = device.stream;

  this._onCancel = function (payload) {
    var callsid = payload.callsid;
    if (self.parameters.CallSid === callsid) {
      self._status = 'closed';
      self.emit('cancel');
      self.pstream.removeListener('cancel', self._onCancel);
    }
  };

  // NOTE(mroberts): The test '#sendDigits throws error' sets this to `null`.
  if (this.pstream) {
    this.pstream.on('cancel', this._onCancel);
    this.pstream.on('ringing', this._onRinging);
  }

  this.on('error', function (error) {
    publisher.error('connection', 'error', {
      code: error.code, message: error.message
    }, self);

    if (self.pstream && self.pstream.status === 'disconnected') {
      cleanupEventListeners(self);
    }
  });

  this.on('disconnect', function () {
    cleanupEventListeners(self);
  });

  return this;
}

util.inherits(Connection, EventEmitter);

/**
 * @return {string}
 */
Connection.toString = function () {
  return '[Twilio.Connection class]';
};

/**
 * @return {string}
 */
Connection.prototype.toString = function () {
  return '[Twilio.Connection instance]';
};
Connection.prototype.sendDigits = function (digits) {
  if (digits.match(/[^0-9*#w]/)) {
    throw new Exception('Illegal character passed into sendDigits');
  }

  var sequence = [];
  digits.split('').forEach(function (digit) {
    var dtmf = digit !== 'w' ? 'dtmf' + digit : '';
    if (dtmf === 'dtmf*') dtmf = 'dtmfs';
    if (dtmf === 'dtmf#') dtmf = 'dtmfh';
    sequence.push(dtmf);
  });

  (function playNextDigit(soundCache) {
    var digit = sequence.shift();
    soundCache.get(digit).play();
    if (sequence.length) {
      setTimeout(playNextDigit.bind(null, soundCache), 200);
    }
  })(this._soundcache);

  var dtmfSender = this.mediaStream.getOrCreateDTMFSender();

  function insertDTMF(dtmfs) {
    if (!dtmfs.length) {
      return;
    }
    var dtmf = dtmfs.shift();

    if (dtmf.length) {
      dtmfSender.insertDTMF(dtmf, DTMF_TONE_DURATION, DTMF_INTER_TONE_GAP);
    }

    setTimeout(insertDTMF.bind(null, dtmfs), DTMF_PAUSE_DURATION);
  }

  if (dtmfSender) {
    if (!('canInsertDTMF' in dtmfSender) || dtmfSender.canInsertDTMF) {
      this.log('Sending digits using RTCDTMFSender');
      // NOTE(mroberts): We can't just map 'w' to ',' since
      // RTCDTMFSender's pause duration is 2 s and Twilio's is more
      // like 500 ms. Instead, we will fudge it with setTimeout.
      insertDTMF(digits.split('w'));
      return;
    }
    this.log('RTCDTMFSender cannot insert DTMF');
  }

  // send pstream message to send DTMF
  this.log('Sending digits over PStream');
  var payload;
  if (this.pstream !== null && this.pstream.status !== 'disconnected') {
    payload = { dtmf: digits, callsid: this.parameters.CallSid };
    this.pstream.publish('dtmf', payload);
  } else {
    payload = { error: {} };
    var error = {
      code: payload.error.code || 31000,
      message: payload.error.message || 'Could not send DTMF: Signaling channel is disconnected',
      connection: this
    };
    this.emit('error', error);
  }
};
Connection.prototype.status = function () {
  return this._status;
};
/**
 * Mute incoming audio.
 */
Connection.prototype.mute = function (shouldMute) {
  if (typeof shouldMute === 'undefined') {
    shouldMute = true;
    this.log.deprecated('.mute() is deprecated. Please use .mute(true) or .mute(false) ' + 'to mute or unmute a call instead.');
  } else if (typeof shouldMute === 'function') {
    this.addListener('mute', shouldMute);
    return;
  }

  if (this.isMuted() === shouldMute) {
    return;
  }
  this.mediaStream.mute(shouldMute);

  var isMuted = this.isMuted();
  this._publisher.info('connection', isMuted ? 'muted' : 'unmuted', null, this);
  this.emit('mute', isMuted, this);
};
/**
 * Check if connection is muted
 */
Connection.prototype.isMuted = function () {
  return this.mediaStream.isMuted;
};
/**
 * Unmute (Deprecated)
 */
Connection.prototype.unmute = function () {
  this.log.deprecated('.unmute() is deprecated. Please use .mute(false) to unmute a call instead.');
  this.mute(false);
};
Connection.prototype.accept = function (handler) {
  if (typeof handler === 'function') {
    this.addListener('accept', handler);
    return;
  }

  if (this._status !== 'pending') {
    return;
  }

  var audioConstraints = handler || this.options.audioConstraints;
  var self = this;
  this._status = 'connecting';

  function connect_() {
    if (self._status !== 'connecting') {
      // call must have been canceled
      cleanupEventListeners(self);
      self.mediaStream.close();
      return;
    }

    function onLocalAnswer(pc) {
      self._publisher.info('connection', 'accepted-by-local', null, self);
      self._monitor.enable(pc);
    }

    function onRemoteAnswer(pc) {
      self._publisher.info('connection', 'accepted-by-remote', null, self);
      self._monitor.enable(pc);
    }

    var sinkIds = typeof self.options.getSinkIds === 'function' && self.options.getSinkIds();
    if (Array.isArray(sinkIds)) {
      self.mediaStream._setSinkIds(sinkIds).catch(function () {
        // (rrowland) We don't want this to throw to console since the customer
        // can't control this. This will most commonly be rejected on browsers
        // that don't support setting sink IDs.
      });
    }

    if (self._direction === 'INCOMING') {
      self._isAnswered = true;
      self.mediaStream.answerIncomingCall(self.parameters.CallSid, self.options.offerSdp, self.options.rtcConstraints, self.options.iceServers, onLocalAnswer);
    } else {
      self.pstream.once('answer', self._onAnswer);
      self.mediaStream.makeOutgoingCall(self.pstream.token, twutil.mapToFormEncoded(self.customParameters), self.outboundConnectionId, self.options.rtcConstraints, self.options.iceServers, onRemoteAnswer);
    }

    self._onHangup = function (payload) {
      /**
       *  see if callsid passed in message matches either callsid or outbound id
       *  connection should always have either callsid or outbound id
       *  if no callsid passed hangup anyways
       */
      if (payload.callsid && (self.parameters.CallSid || self.outboundConnectionId)) {
        if (payload.callsid !== self.parameters.CallSid && payload.callsid !== self.outboundConnectionId) {
          return;
        }
      } else if (payload.callsid) {
        // hangup is for another connection
        return;
      }

      self.log('Received HANGUP from gateway');
      if (payload.error) {
        var error = {
          code: payload.error.code || 31000,
          message: payload.error.message || 'Error sent from gateway in HANGUP',
          connection: self
        };
        self.log('Received an error from the gateway:', error);
        self.emit('error', error);
      }
      self.sendHangup = false;
      self._publisher.info('connection', 'disconnected-by-remote', null, self);
      self._disconnect(null, true);
      cleanupEventListeners(self);
    };
    self.pstream.addListener('hangup', self._onHangup);
  }

  var inputStream = typeof this.options.getInputStream === 'function' && this.options.getInputStream();
  var promise = inputStream ? this.mediaStream.setInputTracksFromStream(inputStream) : this.mediaStream.openWithConstraints(audioConstraints);

  promise.then(function () {
    self._publisher.info('get-user-media', 'succeeded', {
      data: { audioConstraints: audioConstraints }
    }, self);

    connect_();
  }, function (error) {
    var message;
    var code;

    if (error.code && error.code === error.PERMISSION_DENIED || error.name && error.name === 'PermissionDeniedError') {
      code = 31208;
      message = 'User denied access to microphone, or the web browser did not allow microphone ' + 'access at this address.';
      self._publisher.error('get-user-media', 'denied', {
        data: {
          audioConstraints: audioConstraints,
          error: error
        }
      }, self);
    } else {
      code = 31201;
      message = 'Error occurred while accessing microphone: ' + error.name + (error.message ? ' (' + error.message + ')' : '');

      self._publisher.error('get-user-media', 'failed', {
        data: {
          audioConstraints: audioConstraints,
          error: error
        }
      }, self);
    }

    return self._die(message, code);
  });
};
Connection.prototype.reject = function (handler) {
  if (typeof handler === 'function') {
    this.addListener('reject', handler);
    return;
  }

  if (this._status !== 'pending') {
    return;
  }

  var payload = { callsid: this.parameters.CallSid };
  this.pstream.publish('reject', payload);
  this.emit('reject');
  this.mediaStream.reject(this.parameters.CallSid);
  this._publisher.info('connection', 'rejected-by-local', null, this);
};
Connection.prototype.ignore = function (handler) {
  if (typeof handler === 'function') {
    this.addListener('cancel', handler);
    return;
  }

  if (this._status !== 'pending') {
    return;
  }

  this._status = 'closed';
  this.emit('cancel');
  this.mediaStream.ignore(this.parameters.CallSid);
  this._publisher.info('connection', 'ignored-by-local', null, this);
};
Connection.prototype.cancel = function (handler) {
  this.log.deprecated('.cancel() is deprecated. Please use .ignore() instead.');
  this.ignore(handler);
};
Connection.prototype.disconnect = function (handler) {
  if (typeof handler === 'function') {
    this.addListener('disconnect', handler);
    return;
  }
  this._disconnect();
};
Connection.prototype._disconnect = function (message, remote) {
  message = typeof message === 'string' ? message : null;

  if (this._status !== 'open' && this._status !== 'connecting' && this._status !== 'ringing') {
    return;
  }

  this.log('Disconnecting...');

  // send pstream hangup message
  if (this.pstream !== null && this.pstream.status !== 'disconnected' && this.sendHangup) {
    var callId = this.parameters.CallSid || this.outboundConnectionId;
    if (callId) {
      var payload = { callsid: callId };
      if (message) {
        payload.message = message;
      }
      this.pstream.publish('hangup', payload);
    }
  }

  cleanupEventListeners(this);

  this.mediaStream.close();

  if (!remote) {
    this._publisher.info('connection', 'disconnected-by-local', null, this);
  }
};
Connection.prototype.error = function (handler) {
  if (typeof handler === 'function') {
    this.addListener('error', handler);
    return;
  }
};
Connection.prototype._die = function (message, code) {
  this._disconnect();
  this.emit('error', { message: message, code: code });
};

Connection.prototype._setCallSid = function _setCallSid(payload) {
  var callSid = payload.callsid;
  if (!callSid) {
    return;
  }

  this.parameters.CallSid = callSid;
  this.mediaStream.callSid = callSid;
};

Connection.prototype._setSinkIds = function _setSinkIds(sinkIds) {
  return this.mediaStream._setSinkIds(sinkIds);
};

Connection.prototype._setInputTracksFromStream = function _setInputTracksFromStream(stream) {
  return this.mediaStream.setInputTracksFromStream(stream);
};

/**
 * When we get a RINGING signal from PStream, update the {@link Connection} status.
 */
Connection.prototype._onRinging = function (payload) {
  this._setCallSid(payload);

  // If we're not in 'connecting' or 'ringing' state, this event was received out of order.
  if (this._status !== 'connecting' && this._status !== 'ringing') {
    return;
  }

  var hasEarlyMedia = !!payload.sdp;
  if (this.options.enableRingingState) {
    this._status = 'ringing';
    this._publisher.info('connection', 'outgoing-ringing', { hasEarlyMedia: hasEarlyMedia }, this);
    this.emit('ringing', hasEarlyMedia);
    // answerOnBridge=false will send a 183, which we need to interpret as `answer` when
    // the enableRingingState flag is disabled in order to maintain a non-breaking API from 1.4.24
  } else if (hasEarlyMedia) {
    this._onAnswer(payload);
  }
};

Connection.prototype._onAnswer = function (payload) {
  // answerOnBridge=false will send a 183 which we need to catch in _onRinging when
  // the enableRingingState flag is disabled. In that case, we will receive a 200 after
  // the callee accepts the call firing a second `accept` event if we don't
  // short circuit here.
  if (this._isAnswered) {
    return;
  }

  this._setCallSid(payload);
  this._isAnswered = true;
  this._maybeTransitionToOpen();
};

Connection.prototype._maybeTransitionToOpen = function () {
  if (this.mediaStream && this.mediaStream.status === 'open' && this._isAnswered) {
    this._status = 'open';
    this.emit('accept', this);
  }
};

/**
 * Fired on `requestAnimationFrame` (up to 60fps, depending on browser) with
 *   the current input and output volumes, as a percentage of maximum
 *   volume, between -100dB and -30dB. Represented by a floating point
 *   number between 0.0 and 1.0, inclusive.
 * @param {function(number inputVolume, number outputVolume)} handler
 */
Connection.prototype.volume = function (handler) {
  if (!window || !window.AudioContext && !window.webkitAudioContext) {
    // eslint-disable-next-line no-console
    console.warn('This browser does not support Connection.volume');
  } else if (typeof handler === 'function') {
    this.on('volume', handler);
  }
};

/**
 * Get the local MediaStream, if set.
 * @returns {?MediaStream}
 */
Connection.prototype.getLocalStream = function getLocalStream() {
  return this.mediaStream && this.mediaStream.stream;
};

/**
 * Get the remote MediaStream, if set.
 * @returns {?MediaStream}
 */
Connection.prototype.getRemoteStream = function getRemoteStream() {
  return this.mediaStream && this.mediaStream._remoteStream;
};

/**
 * Post an event to Endpoint Analytics indicating that the end user
 *   has given call quality feedback. Called without a score, this
 *   will report that the customer declined to give feedback.
 * @param {?Number} [score] - The end-user's rating of the call; an
 *   integer 1 through 5. Or undefined if the user declined to give
 *   feedback.
 * @param {?String} [issue] - The primary issue the end user
 *   experienced on the call. Can be: ['one-way-audio', 'choppy-audio',
 *   'dropped-call', 'audio-latency', 'noisy-call', 'echo']
 * @returns {Promise}
 */
Connection.prototype.postFeedback = function (score, issue) {
  if (typeof score === 'undefined' || score === null) {
    return this._postFeedbackDeclined();
  }

  if (FEEDBACK_SCORES.indexOf(score) === -1) {
    throw new Error('Feedback score must be one of: ' + FEEDBACK_SCORES);
  }

  if (typeof issue !== 'undefined' && issue !== null && FEEDBACK_ISSUES.indexOf(issue) === -1) {
    throw new Error('Feedback issue must be one of: ' + FEEDBACK_ISSUES);
  }

  return this._publisher.post('info', 'feedback', 'received', {
    /* eslint-disable camelcase */
    quality_score: score,
    issue_name: issue
    /* eslint-enable camelcase */
  }, this, true);
};

/**
 * Post an event to Endpoint Analytics indicating that the end user
 *   has ignored a request for feedback.
 * @private
 * @returns {Promise}
 */
Connection.prototype._postFeedbackDeclined = function () {
  return this._publisher.post('info', 'feedback', 'received-none', null, this, true);
};

Connection.prototype._getTempCallSid = function () {
  return this.outboundConnectionId;
};

Connection.prototype._getRealCallSid = function () {
  return (/^TJ/.test(this.parameters.CallSid) ? null : this.parameters.CallSid
  );
};

function cleanupEventListeners(connection) {
  function cleanup() {
    if (!connection.pstream) {
      return;
    }

    connection.pstream.removeListener('answer', connection._onAnswer);
    connection.pstream.removeListener('cancel', connection._onCancel);
    connection.pstream.removeListener('hangup', connection._onHangup);
    connection.pstream.removeListener('ringing', connection._onRinging);
  }

  // This is kind of a hack, but it lets us avoid rewriting more code.
  // Basically, there's a sequencing problem with the way PeerConnection raises
  // the
  //
  //   Cannot establish connection. Client is disconnected
  //
  // error in Connection#accept. It calls PeerConnection#onerror, which emits
  // the error event on Connection. An error handler on Connection then calls
  // cleanupEventListeners, but then control returns to Connection#accept. It's
  // at this point that we add a listener for the answer event that never gets
  // removed. setTimeout will allow us to rerun cleanup again, _after_
  // Connection#accept returns.
  cleanup();
  setTimeout(cleanup, 0);
}

exports.Connection = Connection;
},{"./log":9,"./rtc":15,"./rtc/monitor":17,"./util":28,"events":37,"util":46}],6:[function(require,module,exports){
'use strict';

var AudioHelper = require('./audiohelper');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var log = require('./log');
var twutil = require('./util');
var rtc = require('./rtc');
var Publisher = require('./eventpublisher');
var Options = require('./options').Options;
var Sound = require('./sound');
var Connection = require('./connection').Connection;
var getUserMedia = require('./rtc/getusermedia');
var PStream = require('./pstream').PStream;

var REG_INTERVAL = 30000;
var RINGTONE_PLAY_TIMEOUT = 2000;

/**
 * Constructor for Device objects.
 *
 * @exports Device as Twilio.Device
 * @memberOf Twilio
 * @borrows EventEmitter#addListener as #addListener
 * @borrows EventEmitter#emit as #emit
 * @borrows EventEmitter#hasListener #hasListener
 * @borrows EventEmitter#removeListener as #removeListener
 * @borrows Twilio.mixinLog-log as #log
 * @constructor
 * @param {string} token The Twilio capabilities token
 * @param {object} [options]
 * @config {boolean} [debug=false]
 */
function Device(token, options) {
  if (!Device.isSupported) {
    throw new twutil.Exception('twilio.js 1.3+ SDKs require WebRTC/ORTC browser support. ' + 'For more information, see <https://www.twilio.com/docs/api/client/twilio-js>. ' + 'If you have any questions about this announcement, please contact ' + 'Twilio Support at <help@twilio.com>.');
  }

  if (!(this instanceof Device)) {
    return new Device(token, options);
  }
  twutil.monitorEventEmitter('Twilio.Device', this);
  if (!token) {
    throw new twutil.Exception('Capability token is not valid or missing.');
  }

  // copy options
  options = options || {};
  var origOptions = {};
  for (var i in options) {
    origOptions[i] = options[i];
  }

  // (rrowland) Lint: This constructor should not be lower case, but if we don't support
  //   the prior name we may break something.
  var DefaultSound = options.soundFactory || Sound;

  var defaults = {
    logPrefix: '[Device]',
    chunderw: 'chunderw-vpc-gll.twilio.com',
    eventgw: 'eventgw.twilio.com',
    Sound: DefaultSound,
    connectionFactory: Connection,
    pStreamFactory: PStream,
    noRegister: false,
    closeProtection: false,
    secureSignaling: true,
    warnings: true,
    audioConstraints: true,
    iceServers: [],
    region: 'gll',
    dscp: true,
    sounds: {}
  };
  options = options || {};
  var chunderw = options.chunderw;
  for (var prop in defaults) {
    if (prop in options) continue;
    options[prop] = defaults[prop];
  }

  if (options.dscp) {
    options.rtcConstraints = {
      optional: [{
        googDscp: true
      }]
    };
  } else {
    options.rtcConstraints = {};
  }

  this.options = options;
  this.token = token;
  this._status = 'offline';
  this._region = 'offline';
  this._connectionSinkIds = ['default'];
  this._connectionInputStream = null;
  this.connections = [];
  this._activeConnection = null;
  this.sounds = new Options({
    incoming: true,
    outgoing: true,
    disconnect: true
  });

  log.mixinLog(this, this.options.logPrefix);
  this.log.enabled = this.options.debug;

  var regions = {
    gll: 'chunderw-vpc-gll.twilio.com',
    au1: 'chunderw-vpc-gll-au1.twilio.com',
    br1: 'chunderw-vpc-gll-br1.twilio.com',
    de1: 'chunderw-vpc-gll-de1.twilio.com',
    ie1: 'chunderw-vpc-gll-ie1.twilio.com',
    jp1: 'chunderw-vpc-gll-jp1.twilio.com',
    sg1: 'chunderw-vpc-gll-sg1.twilio.com',
    us1: 'chunderw-vpc-gll-us1.twilio.com',
    'us1-tnx': 'chunderw-vpc-gll-us1-tnx.twilio.com',
    'us2-tnx': 'chunderw-vpc-gll-us2-tnx.twilio.com',
    'ie1-tnx': 'chunderw-vpc-gll-ie1-tnx.twilio.com',
    'us1-ix': 'chunderw-vpc-gll-us1-ix.twilio.com',
    'us2-ix': 'chunderw-vpc-gll-us2-ix.twilio.com',
    'ie1-ix': 'chunderw-vpc-gll-ie1-ix.twilio.com'
  };
  var deprecatedRegions = {
    au: 'au1',
    br: 'br1',
    ie: 'ie1',
    jp: 'jp1',
    sg: 'sg1',
    'us-va': 'us1',
    'us-or': 'us1'
  };
  var region = options.region.toLowerCase();
  if (region in deprecatedRegions) {
    this.log.deprecated('Region ' + region + ' is deprecated, please use ' + deprecatedRegions[region] + '.');
    region = deprecatedRegions[region];
  }
  if (!(region in regions)) {
    throw new twutil.Exception('Region ' + options.region + ' is invalid. ' + 'Valid values are: ' + Object.keys(regions).join(', '));
  }
  options.chunderw = chunderw || regions[region];

  this.soundcache = new Map();

  // NOTE(mroberts): Node workaround.
  var a = typeof document !== 'undefined' ? document.createElement('audio') : {};

  var canPlayMp3;
  try {
    canPlayMp3 = a.canPlayType && !!a.canPlayType('audio/mpeg').replace(/no/, '');
  } catch (e) {
    canPlayMp3 = false;
  }

  var canPlayVorbis;
  try {
    canPlayVorbis = a.canPlayType && !!a.canPlayType('audio/ogg;codecs=\'vorbis\'').replace(/no/, '');
  } catch (e) {
    canPlayVorbis = false;
  }

  var ext = 'mp3';
  if (canPlayVorbis && !canPlayMp3) {
    ext = 'ogg';
  }

  var defaultSounds = {
    incoming: { filename: 'incoming', shouldLoop: true },
    outgoing: { filename: 'outgoing', maxDuration: 3000 },
    disconnect: { filename: 'disconnect', maxDuration: 3000 },
    dtmf1: { filename: 'dtmf-1', maxDuration: 1000 },
    dtmf2: { filename: 'dtmf-2', maxDuration: 1000 },
    dtmf3: { filename: 'dtmf-3', maxDuration: 1000 },
    dtmf4: { filename: 'dtmf-4', maxDuration: 1000 },
    dtmf5: { filename: 'dtmf-5', maxDuration: 1000 },
    dtmf6: { filename: 'dtmf-6', maxDuration: 1000 },
    dtmf7: { filename: 'dtmf-7', maxDuration: 1000 },
    dtmf8: { filename: 'dtmf-8', maxDuration: 1000 },
    dtmf9: { filename: 'dtmf-9', maxDuration: 1000 },
    dtmf0: { filename: 'dtmf-0', maxDuration: 1000 },
    dtmfs: { filename: 'dtmf-star', maxDuration: 1000 },
    dtmfh: { filename: 'dtmf-hash', maxDuration: 1000 }
  };

  var base = twutil.getTwilioRoot() + 'sounds/releases/' + twutil.getSoundVersion() + '/';
  for (var name in defaultSounds) {
    var soundDef = defaultSounds[name];

    var defaultUrl = base + soundDef.filename + '.' + ext + '?cache=1_4_23';
    var soundUrl = options.sounds[name] || defaultUrl;
    var sound = new this.options.Sound(name, soundUrl, {
      maxDuration: soundDef.maxDuration,
      minDuration: soundDef.minDuration,
      shouldLoop: soundDef.shouldLoop,
      audioContext: this.options.disableAudioContextSounds ? null : Device.audioContext
    });

    this.soundcache.set(name, sound);
  }

  var self = this;

  function createDefaultPayload(connection) {
    var payload = {
      /* eslint-disable camelcase */
      client_name: self._clientName,
      platform: rtc.getMediaEngine(),
      sdk_version: twutil.getReleaseVersion(),
      selected_region: self.options.region
      /* eslint-enable camelcase */
    };

    function setIfDefined(propertyName, value) {
      if (value) {
        payload[propertyName] = value;
      }
    }

    if (connection) {
      setIfDefined('call_sid', connection._getRealCallSid());
      setIfDefined('temp_call_sid', connection._getTempCallSid());
      payload.direction = connection._direction;
    }

    var stream = self.stream;
    if (stream) {
      setIfDefined('gateway', stream.gateway);
      setIfDefined('region', stream.region);
    }

    return payload;
  }

  var publisher = this._publisher = new Publisher('twilio-js-sdk', this.token, {
    host: this.options.eventgw,
    defaultPayload: createDefaultPayload
  });

  if (options.publishEvents === false) {
    publisher.disable();
  }

  function updateSinkIds(type, sinkIds) {
    var promise = type === 'ringtone' ? updateRingtoneSinkIds(sinkIds) : updateSpeakerSinkIds(sinkIds);

    return promise.then(function () {
      publisher.info('audio', type + '-devices-set', {
        // eslint-disable-next-line camelcase
        audio_device_ids: sinkIds
      }, self._activeConnection);
    }, function (error) {
      publisher.error('audio', type + '-devices-set-failed', {
        // eslint-disable-next-line camelcase
        audio_device_ids: sinkIds,
        message: error.message
      }, self._activeConnection);

      throw error;
    });
  }

  function updateSpeakerSinkIds(sinkIds) {
    sinkIds = sinkIds.forEach ? sinkIds : [sinkIds];
    Array.from(self.soundcache.entries()).forEach(function (entry) {
      if (entry[0] !== 'incoming') {
        entry[1].setSinkIds(sinkIds);
      }
    });

    // To be used in new connections
    self._connectionSinkIds = sinkIds;

    // To be used in existing connections
    var connection = self._activeConnection;
    return connection ? connection._setSinkIds(sinkIds) : Promise.resolve();
  }

  function updateRingtoneSinkIds(sinkIds) {
    return Promise.resolve(self.soundcache.get('incoming').setSinkIds(sinkIds));
  }

  function updateInputStream(inputStream) {
    var connection = self._activeConnection;

    if (connection && !inputStream) {
      return Promise.reject(new Error('Cannot unset input device while a call is in progress.'));
    }

    // To be used in new connections
    self._connectionInputStream = inputStream;

    // To be used in existing connections
    return connection ? connection._setInputTracksFromStream(inputStream) : Promise.resolve();
  }

  var audio = this.audio = new AudioHelper(updateSinkIds, updateInputStream, getUserMedia, {
    audioContext: Device.audioContext,
    logEnabled: !!this.options.debug,
    logWarnings: !!this.options.warnings,
    soundOptions: this.sounds
  });

  audio.on('deviceChange', function (lostActiveDevices) {
    var activeConnection = self._activeConnection;
    var deviceIds = lostActiveDevices.map(function (device) {
      return device.deviceId;
    });

    publisher.info('audio', 'device-change', {
      // eslint-disable-next-line camelcase
      lost_active_device_ids: deviceIds
    }, activeConnection);

    if (activeConnection) {
      activeConnection.mediaStream._onInputDevicesChanged();
    }
  });

  // setup flag for allowing presence for media types
  this.mediaPresence = { audio: !this.options.noRegister };

  // setup stream
  this.register(this.token);

  var closeProtection = this.options.closeProtection;
  // eslint-disable-next-line consistent-return
  function confirmClose(event) {
    if (self._activeConnection) {
      var defaultMsg = 'A call is currently in-progress. ' + 'Leaving or reloading this page will end the call.';
      var confirmationMsg = closeProtection === true ? defaultMsg : closeProtection;
      (event || window.event).returnValue = confirmationMsg;
      return confirmationMsg;
    }
  }

  if (closeProtection) {
    if (typeof window !== 'undefined') {
      if (window.addEventListener) {
        window.addEventListener('beforeunload', confirmClose);
      } else if (window.attachEvent) {
        window.attachEvent('onbeforeunload', confirmClose);
      }
    }
  }

  // close connections on unload
  function onClose() {
    self.disconnectAll();
  }

  if (typeof window !== 'undefined') {
    if (window.addEventListener) {
      window.addEventListener('unload', onClose);
    } else if (window.attachEvent) {
      window.attachEvent('onunload', onClose);
    }
  }

  // NOTE(mroberts): EventEmitter requires that we catch all errors.
  this.on('error', function () {});

  return this;
}

util.inherits(Device, EventEmitter);

function makeConnection(device, params, options) {
  var defaults = {
    getSinkIds: function getSinkIds() {
      return device._connectionSinkIds;
    },
    getInputStream: function getInputStream() {
      return device._connectionInputStream;
    },
    debug: device.options.debug,
    warnings: device.options.warnings,
    publisher: device._publisher,
    enableRingingState: device.options.enableRingingState
  };

  options = options || {};
  for (var prop in defaults) {
    if (prop in options) continue;
    options[prop] = defaults[prop];
  }

  var connection = device.options.connectionFactory(device, params, getUserMedia, options);

  connection.once('accept', function () {
    device._activeConnection = connection;
    device._removeConnection(connection);
    device.audio._maybeStartPollingVolume();
    device.emit('connect', connection);
  });
  connection.addListener('error', function (error) {
    if (connection.status() === 'closed') {
      device._removeConnection(connection);
    }
    device.audio._maybeStopPollingVolume();
    device.emit('error', error);
  });
  connection.once('cancel', function () {
    device.log('Canceled: ' + connection.parameters.CallSid);
    device._removeConnection(connection);
    device.audio._maybeStopPollingVolume();
    device.emit('cancel', connection);
  });
  connection.once('disconnect', function () {
    device.audio._maybeStopPollingVolume();
    device._removeConnection(connection);
    if (device._activeConnection === connection) {
      device._activeConnection = null;
    }
    device.emit('disconnect', connection);
  });
  connection.once('reject', function () {
    device.log('Rejected: ' + connection.parameters.CallSid);
    device.audio._maybeStopPollingVolume();
    device._removeConnection(connection);
  });

  return connection;
}

Object.defineProperties(Device, {
  isSupported: {
    get: function get() {
      return rtc.enabled();
    }
  }
});

/**
 * @return {string}
 */
Device.toString = function () {
  return '[Twilio.Device class]';
};

/**
 * @return {string}
 */
Device.prototype.toString = function () {
  return '[Twilio.Device instance]';
};
Device.prototype.register = function (token) {
  var objectized = twutil.objectize(token);
  this._accountSid = objectized.iss;
  this._clientName = objectized.scope['client:incoming'] ? objectized.scope['client:incoming'].params.clientName : null;

  if (this.stream) {
    this.stream.setToken(token);
    this._publisher.setToken(token);
  } else {
    this._setupStream(token);
  }
};
Device.prototype.registerPresence = function () {
  if (!this.token) {
    return;
  }

  // check token, if incoming capable then set mediaPresence capability to true
  var tokenIncomingObject = twutil.objectize(this.token).scope['client:incoming'];
  if (tokenIncomingObject) {
    this.mediaPresence.audio = true;
  }

  this._sendPresence();
};
Device.prototype.unregisterPresence = function () {
  this.mediaPresence.audio = false;
  this._sendPresence();
};
Device.prototype.connect = function (params, audioConstraints) {
  if (typeof params === 'function') {
    return this.addListener('connect', params);
  }

  if (this._activeConnection) {
    throw new Error('A Connection is already active');
  }

  params = params || {};
  audioConstraints = audioConstraints || this.options.audioConstraints;
  var connection = this._activeConnection = makeConnection(this, params);

  // Make sure any incoming connections are ignored
  this.connections.splice(0).forEach(function (conn) {
    conn.ignore();
  });

  // Stop the incoming sound if it's playing
  this.soundcache.get('incoming').stop();

  if (this.sounds.__dict__.outgoing) {
    var self = this;
    connection.accept(function () {
      self.soundcache.get('outgoing').play();
    });
  }
  connection.accept(audioConstraints);
  return connection;
};
Device.prototype.disconnectAll = function () {
  // Create a copy of connections before iterating, because disconnect
  // will trigger callbacks which modify the connections list. At the end
  // of the iteration, this.connections should be an empty list.
  var connections = [].concat(this.connections);
  for (var i = 0; i < connections.length; i++) {
    connections[i].disconnect();
  }
  if (this._activeConnection) {
    this._activeConnection.disconnect();
  }
  if (this.connections.length > 0) {
    this.log('Connections left pending: ' + this.connections.length);
  }
};
Device.prototype.destroy = function () {
  this._stopRegistrationTimer();
  this.audio._unbind();
  if (this.stream) {
    this.stream.destroy();
    this.stream = null;
  }
};
Device.prototype.disconnect = function (handler) {
  this.addListener('disconnect', handler);
};
Device.prototype.incoming = function (handler) {
  this.addListener('incoming', handler);
};
Device.prototype.offline = function (handler) {
  this.addListener('offline', handler);
};
Device.prototype.ready = function (handler) {
  this.addListener('ready', handler);
};
Device.prototype.error = function (handler) {
  this.addListener('error', handler);
};
Device.prototype.status = function () {
  return this._activeConnection ? 'busy' : this._status;
};
Device.prototype.activeConnection = function () {
  // @rrowland This should only return activeConnection, but customers have built around this
  // broken behavior and in order to not break their apps we are including this until
  // the next big release.
  // (TODO) Remove the second half of this statement in the next breaking release
  return this._activeConnection || this.connections[0];
};
Device.prototype.region = function () {
  return this._region;
};
Device.prototype._sendPresence = function () {
  if (!this.stream) {
    return;
  }

  this.stream.register(this.mediaPresence);
  if (this.mediaPresence.audio) {
    this._startRegistrationTimer();
  } else {
    this._stopRegistrationTimer();
  }
};
Device.prototype._startRegistrationTimer = function () {
  clearTimeout(this.regTimer);
  var self = this;
  this.regTimer = setTimeout(function () {
    self._sendPresence();
  }, REG_INTERVAL);
};
Device.prototype._stopRegistrationTimer = function () {
  clearTimeout(this.regTimer);
};
Device.prototype._setupStream = function (token) {
  var self = this;
  this.log('Setting up PStream');
  var streamOptions = {
    chunderw: this.options.chunderw,
    debug: this.options.debug,
    secureSignaling: this.options.secureSignaling
  };
  this.stream = this.options.pStreamFactory(token, streamOptions);
  this.stream.addListener('connected', function (payload) {
    var regions = {
      US_EAST_VIRGINIA: 'us1',
      US_WEST_OREGON: 'us2',
      ASIAPAC_SYDNEY: 'au1',
      SOUTH_AMERICA_SAO_PAULO: 'br1',
      EU_IRELAND: 'ie1',
      ASIAPAC_TOKYO: 'jp1',
      ASIAPAC_SINGAPORE: 'sg1'
    };
    self._region = regions[payload.region] || payload.region;
    self._sendPresence();
  });
  this.stream.addListener('close', function () {
    self.stream = null;
  });
  this.stream.addListener('ready', function () {
    self.log('Stream is ready');
    if (self._status === 'offline') {
      self._status = 'ready';
    }
    self.emit('ready', self);
  });
  this.stream.addListener('offline', function () {
    self.log('Stream is offline');
    self._status = 'offline';
    self._region = 'offline';
    self.emit('offline', self);
  });
  this.stream.addListener('error', function (payload) {
    var error = payload.error;
    if (error) {
      if (payload.callsid) {
        error.connection = self._findConnection(payload.callsid);
      }
      // Stop trying to register presence after token expires
      if (error.code === 31205) {
        self._stopRegistrationTimer();
      }
      self.log('Received error: ', error);
      self.emit('error', error);
    }
  });
  this.stream.addListener('invite', function (payload) {
    if (self._activeConnection) {
      self.log('Device busy; ignoring incoming invite');
      return;
    }

    if (!payload.callsid || !payload.sdp) {
      self.emit('error', { message: 'Malformed invite from gateway' });
      return;
    }

    function maybeStopIncomingSound() {
      if (!self.connections.length) {
        self.soundcache.get('incoming').stop();
      }
    }

    var callParams = payload.parameters || {};
    callParams.CallSid = callParams.CallSid || payload.callsid;

    var params = Object.assign({}, twutil.formEncodedToJson(callParams.Params));

    var connection = makeConnection(self, params, {
      offerSdp: payload.sdp,
      callParameters: callParams
    });

    self.connections.push(connection);

    connection.once('accept', function () {
      self.soundcache.get('incoming').stop();
    });

    ['cancel', 'error', 'reject'].forEach(function (event) {
      connection.once(event, maybeStopIncomingSound);
    });

    var play = self.sounds.__dict__.incoming ? function () {
      return self.soundcache.get('incoming').play();
    } : function () {
      return Promise.resolve();
    };

    self._showIncomingConnection(connection, play);
  });
};

Device.prototype._showIncomingConnection = function (connection, play) {
  var self = this;
  var timeout;
  return Promise.race([play(), new Promise(function (resolve, reject) {
    timeout = setTimeout(function () {
      reject(new Error('Playing incoming ringtone took too long; it might not play. Continuing execution...'));
    }, RINGTONE_PLAY_TIMEOUT);
  })]).catch(function (reason) {
    // eslint-disable-next-line no-console
    console.warn(reason.message);
  }).then(function () {
    clearTimeout(timeout);
    self.emit('incoming', connection);
  });
};

Device.prototype._removeConnection = function (connection) {
  for (var i = this.connections.length - 1; i >= 0; i--) {
    if (connection === this.connections[i]) {
      this.connections.splice(i, 1);
    }
  }
};
Device.prototype._findConnection = function (callsid) {
  for (var i = 0; i < this.connections.length; i++) {
    var conn = this.connections[i];
    if (conn.parameters.CallSid === callsid || conn.outboundConnectionId === callsid) {
      return conn;
    }
  }

  return null;
};

function singletonwrapper(cls) {
  var afterSetup = [];
  var tasks = [];
  function enqueue(task) {
    if (cls.instance) {
      task();
    } else {
      tasks.push(task);
    }
  }

  function defaultErrorHandler(error) {
    var errorMessage = (error.code ? error.code + ': ' : '') + error.message;
    if (cls.instance) {
      // The defaultErrorHandler throws an Exception iff there are no
      // other error handlers registered on a Device instance. To check
      // this, we need to count up the number of error handlers
      // registered, excluding our own defaultErrorHandler.
      var n = 0;
      var listeners = cls.instance.listeners('error');
      for (var i = 0; i < listeners.length; i++) {
        if (listeners[i] !== defaultErrorHandler) {
          n++;
        }
      }
      // Note that there is always one default, noop error handler on
      // each of our EventEmitters.
      if (n > 1) {
        return;
      }
      cls.instance.log(errorMessage);
    }
    throw new twutil.Exception(errorMessage);
  }
  var members = /** @lends Twilio.Device */{
    /**
     * Instance of Twilio.Device.
     *
     * @type Twilio.Device
     */
    instance: null,
    /**
     * @param {string} token
     * @param {object} [options]
     * @return {Twilio.Device}
     */
    setup: function setup(token, options) {
      if (!cls.audioContext) {
        if (typeof AudioContext !== 'undefined') {
          cls.audioContext = new AudioContext();
        } else if (typeof webkitAudioContext !== 'undefined') {
          // eslint-disable-next-line
          cls.audioContext = new webkitAudioContext();
        }
      }

      var i;
      if (cls.instance) {
        cls.instance.log('Found existing Device; using new token but ignoring options');
        cls.instance.token = token;
        cls.instance.register(token);
      } else {
        cls.instance = new Device(token, options);
        cls.error(defaultErrorHandler);
        cls.sounds = cls.instance.sounds;
        for (i = 0; i < tasks.length; i++) {
          tasks[i]();
        }
        tasks = [];
      }

      for (i = 0; i < afterSetup.length; i++) {
        afterSetup[i](token, options);
      }
      afterSetup = [];

      return cls;
    },

    /**
     * Connects to Twilio.
     *
     * @param {object} parameters
     * @return {Twilio.Connection}
     */
    connect: function connect(parameters, audioConstraints) {
      if (typeof parameters === 'function') {
        enqueue(function () {
          cls.instance.addListener('connect', parameters);
        });
        return null;
      }
      if (!cls.instance) {
        throw new twutil.Exception('Run Twilio.Device.setup()');
      }
      if (cls.instance.connections.length > 0) {
        cls.instance.emit('error', { message: 'A connection is currently active' });
        return null;
      }
      return cls.instance.connect(parameters, audioConstraints);
    },

    /**
     * @return {Twilio.Device}
     */
    disconnectAll: function disconnectAll() {
      enqueue(function () {
        cls.instance.disconnectAll();
      });
      return cls;
    },
    /**
     * @param {function} handler
     * @return {Twilio.Device}
     */
    disconnect: function disconnect(handler) {
      enqueue(function () {
        cls.instance.addListener('disconnect', handler);
      });
      return cls;
    },
    status: function status() {
      if (!cls.instance) {
        throw new twutil.Exception('Run Twilio.Device.setup()');
      }
      return cls.instance.status();
    },
    region: function region() {
      if (!cls.instance) {
        throw new twutil.Exception('Run Twilio.Device.setup()');
      }
      return cls.instance.region();
    },
    /**
     * @param {function} handler
     * @return {Twilio.Device}
     */
    ready: function ready(handler) {
      enqueue(function () {
        cls.instance.addListener('ready', handler);
      });
      return cls;
    },

    /**
     * @param {function} handler
     * @return {Twilio.Device}
     */
    error: function error(handler) {
      enqueue(function () {
        if (handler !== defaultErrorHandler) {
          cls.instance.removeListener('error', defaultErrorHandler);
        }
        cls.instance.addListener('error', handler);
      });
      return cls;
    },

    /**
     * @param {function} handler
     * @return {Twilio.Device}
     */
    offline: function offline(handler) {
      enqueue(function () {
        cls.instance.addListener('offline', handler);
      });
      return cls;
    },

    /**
     * @param {function} handler
     * @return {Twilio.Device}
     */
    incoming: function incoming(handler) {
      enqueue(function () {
        cls.instance.addListener('incoming', handler);
      });
      return cls;
    },

    /**
     * @return {Twilio.Device}
     */
    destroy: function destroy() {
      if (cls.instance) {
        cls.instance.destroy();
      }
      return cls;
    },

    /**
     * @return {Twilio.Device}
     */
    cancel: function cancel(handler) {
      enqueue(function () {
        cls.instance.addListener('cancel', handler);
      });
      return cls;
    },

    activeConnection: function activeConnection() {
      if (!cls.instance) {
        return null;
      }
      return cls.instance.activeConnection();
    }
  };

  for (var method in members) {
    cls[method] = members[method];
  }

  Object.defineProperties(cls, {
    audio: {
      get: function get() {
        return cls.instance.audio;
      }
    }
  });

  return cls;
}

exports.Device = singletonwrapper(Device);
},{"./audiohelper":4,"./connection":5,"./eventpublisher":7,"./log":9,"./options":10,"./pstream":12,"./rtc":15,"./rtc/getusermedia":14,"./sound":25,"./util":28,"events":37,"util":46}],7:[function(require,module,exports){
'use strict';

var request = require('./request');

/**
 * Builds Endpoint Analytics (EA) event payloads and sends them to
 *   the EA server.
 * @constructor
 * @param {String} productName - Name of the product publishing events.
 * @param {String} token - The JWT token to use to authenticate with
 *   the EA server.
 * @param {EventPublisher.Options} options
 * @property {Boolean} isEnabled - Whether or not this publisher is publishing
 *   to the server. Currently ignores the request altogether, in the future this
 *   may store them in case publishing is re-enabled later. Defaults to true.
 */ /**
    * @typedef {Object} EventPublisher.Options
    * @property {String} [host='eventgw.twilio.com'] - The host address of the EA
    *   server to publish to.
    * @property {Object|Function} [defaultPayload] - A default payload to extend
    *   when creating and sending event payloads. Also takes a function that
    *   should return an object representing the default payload. This is
    *   useful for fields that should always be present when they are
    *   available, but are not always available.
    */
function EventPublisher(productName, token, options) {
  if (!(this instanceof EventPublisher)) {
    return new EventPublisher(productName, token, options);
  }

  // Apply default options
  options = Object.assign({
    defaultPayload: function defaultPayload() {
      return {};
    },
    host: 'eventgw.twilio.com'
  }, options);

  var defaultPayload = options.defaultPayload;

  if (typeof defaultPayload !== 'function') {
    defaultPayload = function defaultPayload() {
      return Object.assign({}, options.defaultPayload);
    };
  }

  var isEnabled = true;
  Object.defineProperties(this, {
    _defaultPayload: { value: defaultPayload },
    _isEnabled: {
      get: function get() {
        return isEnabled;
      },
      set: function set(_isEnabled) {
        isEnabled = _isEnabled;
      }
    },
    _host: { value: options.host },
    _request: { value: options.request || request },
    _token: { value: token, writable: true },
    isEnabled: {
      enumerable: true,
      get: function get() {
        return isEnabled;
      }
    },
    productName: { enumerable: true, value: productName },
    token: {
      enumerable: true,
      get: function get() {
        return this._token;
      }
    }
  });
}

/**
 * Post to an EA server.
 * @private
 * @param {String} endpointName - Endpoint to post the event to
 * @param {String} level - ['debug', 'info', 'warning', 'error']
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {?Object} [payload=null] - The payload to pass. This will be extended
 *    onto the default payload object, if one exists.
 * @param {?Connection} [connection=null] - The {@link Connection} which is posting this payload.
 * @param {?Boolean} [force=false] - Whether or not to send this even if
 *    publishing is disabled.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype._post = function _post(endpointName, level, group, name, payload, connection, force) {
  if (!this.isEnabled && !force) {
    return Promise.resolve();
  }

  var event = {
    /* eslint-disable camelcase */
    publisher: this.productName,
    group: group,
    name: name,
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    payload_type: 'application/json',
    private: false,
    payload: payload && payload.forEach ? payload.slice(0) : Object.assign(this._defaultPayload(connection), payload)
    /* eslint-enable camelcase */
  };

  var requestParams = {
    url: 'https://' + this._host + '/v2/' + endpointName,
    body: event,
    headers: {
      'Content-Type': 'application/json',
      'X-Twilio-Token': this.token
    }
  };

  var self = this;
  return new Promise(function (resolve, reject) {
    self._request.post(requestParams, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

/**
 * Post an event to the EA server. Use this method when the level
 *  is dynamic. Otherwise, it's better practice to use the sugar
 *  methods named for the specific level.
 * @param {String} level - ['debug', 'info', 'warning', 'error']
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {?Object} [payload=null] - The payload to pass. This will be extended
 *    onto the default payload object, if one exists.
 * @param {?Connection} [connection=null] - The {@link Connection} which is posting this payload.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype.post = function post(level, group, name, payload, connection, force) {
  return this._post('EndpointEvents', level, group, name, payload, connection, force);
};

/**
 * Post a debug-level event to the EA server.
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {?Object} [payload=null] - The payload to pass. This will be extended
 *    onto the default payload object, if one exists.
 * @param {?Connection} [connection=null] - The {@link Connection} which is posting this payload.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype.debug = function debug(group, name, payload, connection) {
  return this.post('debug', group, name, payload, connection);
};

/**
 * Post an info-level event to the EA server.
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {?Object} [payload=null] - The payload to pass. This will be extended
 *    onto the default payload object, if one exists.
 * @param {?Connection} [connection=null] - The {@link Connection} which is posting this payload.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype.info = function info(group, name, payload, connection) {
  return this.post('info', group, name, payload, connection);
};

/**
 * Post a warning-level event to the EA server.
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {?Object} [payload=null] - The payload to pass. This will be extended
 *    onto the default payload object, if one exists.
 * @param {?Connection} [connection=null] - The {@link Connection} which is posting this payload.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype.warn = function warn(group, name, payload, connection) {
  return this.post('warning', group, name, payload, connection);
};

/**
 * Post an error-level event to the EA server.
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {?Object} [payload=null] - The payload to pass. This will be extended
 *    onto the default payload object, if one exists.
 * @param {?Connection} [connection=null] - The {@link Connection} which is posting this payload.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype.error = function error(group, name, payload, connection) {
  return this.post('error', group, name, payload, connection);
};

/**
 * Post a metrics event to the EA server.
 * @param {String} group - The name of the group the event belongs to.
 * @param {String} name - The designated event name.
 * @param {Array<Object>} metrics - The metrics to post.
 * @param {?Object} [customFields] - Custom fields to append to each payload.
 * @returns {Promise} Fulfilled if the HTTP response is 20x.
 */
EventPublisher.prototype.postMetrics = function postMetrics(group, name, metrics, customFields) {
  var self = this;
  return new Promise(function (resolve) {
    var samples = metrics.map(formatMetric).map(function (sample) {
      return Object.assign(sample, customFields);
    });

    resolve(self._post('EndpointMetrics', 'info', group, name, samples));
  });
};

/**
 * Update the token to use to authenticate requests.
 * @param {string} token
 * @returns {void}
 */
EventPublisher.prototype.setToken = function setToken(token) {
  this._token = token;
};

/**
 * Enable the publishing of events.
 */
EventPublisher.prototype.enable = function enable() {
  this._isEnabled = true;
};

/**
 * Disable the publishing of events.
 */
EventPublisher.prototype.disable = function disable() {
  this._isEnabled = false;
};

function formatMetric(sample) {
  return {
    /* eslint-disable camelcase */
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
    /* eslint-enable camelcase */
  };
}

module.exports = EventPublisher;
},{"./request":13}],8:[function(require,module,exports){
'use strict';

/**
 * Heartbeat just wants you to call <code>beat()</code> every once in a while.
 *
 * <p>It initializes a countdown timer that expects a call to
 * <code>Hearbeat#beat</code> every n seconds. If <code>beat()</code> hasn't
 * been called for <code>#interval</code> seconds, it emits a
 * <code>onsleep</code> event and waits. The next call to <code>beat()</code>
 * emits <code>onwakeup</code> and initializes a new timer.</p>
 *
 * <p>For example:</p>
 *
 * @example
 *
 *     >>> hb = new Heartbeat({
 *     ...   interval: 10,
 *     ...   onsleep: function() { console.log('Gone to sleep...Zzz...'); },
 *     ...   onwakeup: function() { console.log('Awake already!'); },
 *     ... });
 *
 *     >>> hb.beat(); # then wait 10 seconds
 *     Gone to sleep...Zzz...
 *     >>> hb.beat();
 *     Awake already!
 *
 * @exports Heartbeat as Twilio.Heartbeat
 * @memberOf Twilio
 * @constructor
 * @param {object} opts Options for Heartbeat
 * @config {int} [interval=10] Seconds between each call to <code>beat</code>
 * @config {function} [onsleep] Callback for sleep events
 * @config {function} [onwakeup] Callback for wakeup events
 */

function Heartbeat(opts) {
  if (!(this instanceof Heartbeat)) return new Heartbeat(opts);
  opts = opts || {};
  function noop() {}
  var defaults = {
    interval: 10,
    now: function now() {
      return new Date().getTime();
    },
    repeat: function repeat(f, t) {
      return setInterval(f, t);
    },
    stop: function stop(f, t) {
      return clearInterval(f, t);
    },
    onsleep: noop,
    onwakeup: noop
  };
  for (var prop in defaults) {
    if (prop in opts) continue;
    opts[prop] = defaults[prop];
  }
  /**
   * Number of seconds with no beat before sleeping.
   * @type number
   */
  this.interval = opts.interval;
  this.lastbeat = 0;
  this.pintvl = null;

  /**
   * Invoked when this object has not received a call to <code>#beat</code>
   * for an elapsed period of time greater than <code>#interval</code>
   * seconds.
   *
   * @event
   */
  this.onsleep = opts.onsleep;

  /**
   * Invoked when this object is sleeping and receives a call to
   * <code>#beat</code>.
   *
   * @event
   */
  this.onwakeup = opts.onwakeup;

  this.repeat = opts.repeat;
  this.stop = opts.stop;
  this.now = opts.now;
}

/**
 * @return {string}
 */
Heartbeat.toString = function () {
  return '[Twilio.Heartbeat class]';
};

/**
 * @return {string}
 */
Heartbeat.prototype.toString = function () {
  return '[Twilio.Heartbeat instance]';
};
/**
 * Keeps the instance awake (by resetting the count down); or if asleep,
 * wakes it up.
 */
Heartbeat.prototype.beat = function () {
  this.lastbeat = this.now();
  if (this.sleeping()) {
    if (this.onwakeup) {
      this.onwakeup();
    }
    var self = this;
    this.pintvl = this.repeat.call(null, function () {
      self.check();
    }, this.interval * 1000);
  }
};
/**
 * Goes into a sleep state if the time between now and the last heartbeat
 * is greater than or equal to the specified <code>interval</code>.
 */
Heartbeat.prototype.check = function () {
  var timeidle = this.now() - this.lastbeat;
  if (!this.sleeping() && timeidle >= this.interval * 1000) {
    if (this.onsleep) {
      this.onsleep();
    }
    this.stop.call(null, this.pintvl);

    this.pintvl = null;
  }
};
/**
 * @return {boolean} True if sleeping
 */
Heartbeat.prototype.sleeping = function () {
  return this.pintvl === null;
};
exports.Heartbeat = Heartbeat;
},{}],9:[function(require,module,exports){
'use strict';

/**
 * Bestow logging powers.
 *
 * @exports mixinLog as Twilio.mixinLog
 * @memberOf Twilio
 *
 * @param {object} object The object to bestow logging powers to
 * @param {string} [prefix] Prefix log messages with this
 *
 * @return {object} Return the object passed in
 */

function mixinLog(object, prefix) {
  /**
   * Logs a message or object.
   *
   * <p>There are a few options available for the log mixin. Imagine an object
   * <code>foo</code> with this function mixed in:</p>
   *
   * <pre><code>var foo = {};
   * Twilio.mixinLog(foo);
   *
   * </code></pre>
   *
   * <p>To enable or disable the log: <code>foo.log.enabled = true</code></p>
   *
   * <p>To modify the prefix: <code>foo.log.prefix = 'Hello'</code></p>
   *
   * <p>To use a custom callback instead of <code>console.log</code>:
   * <code>foo.log.handler = function() { ... };</code></p>
   *
   * @param *args Messages or objects to be logged
   */
  function log() {
    if (!log.enabled) {
      return;
    }
    var format = log.prefix ? log.prefix + ' ' : '';
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      log.handler(typeof arg === 'string' ? format + arg : arg);
    }
  }

  function defaultWarnHandler(x) {
    /* eslint-disable no-console */
    if (typeof console !== 'undefined') {
      if (typeof console.warn === 'function') {
        console.warn(x);
      } else if (typeof console.log === 'function') {
        console.log(x);
      }
    }
    /* eslint-enable no-console */
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
  log.prefix = prefix || '';
  /** @ignore */
  log.defaultHandler = function (x) {
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') {
      console.log(x);
    }
  };
  log.handler = log.defaultHandler;
  log.warnings = true;
  log.defaultWarnHandler = defaultWarnHandler;
  log.warnHandler = log.defaultWarnHandler;
  log.deprecated = deprecated;
  log.warn = deprecated;

  object.log = log;
}
exports.mixinLog = mixinLog;
},{}],10:[function(require,module,exports){
'use strict';

var Log = require('./log');
var SOUNDS_DEPRECATION_WARNING = require('./strings').SOUNDS_DEPRECATION_WARNING;

exports.Options = function () {
  function Options(defaults, assignments) {
    if (!(this instanceof Options)) {
      return new Options(defaults);
    }
    this.__dict__ = {};
    defaults = defaults || {};
    assignments = assignments || {};
    Log.mixinLog(this, '[Sounds]');

    var hasBeenWarned = false;
    function makeprop(__dict__, name, log) {
      return function (value, shouldSilence) {
        if (!shouldSilence && !hasBeenWarned) {
          hasBeenWarned = true;
          log.deprecated(SOUNDS_DEPRECATION_WARNING);
        }

        if (typeof value !== 'undefined') {
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
},{"./log":9,"./strings":27}],11:[function(require,module,exports){
'use strict';

var util = require('./util');
var DEFAULT_TEST_SOUND_URL = util.getTwilioRoot() + 'sounds/releases/' + util.getSoundVersion() + '/outgoing.mp3';

/**
 * A smart collection containing a Set of active output devices.
 * @class
 * @private
 * @param {string} name - The name of this collection of devices. This will be returned
 *   with beforeChange.
 * @param {Map<string deviceId, MediaDeviceInfo device>} A Map of the available devices
 *   to search within for getting and setting devices. This Map may change externally.
 * @param {OutputDeviceCollection~beforeChange} beforeChange
 * @param {Boolean} isSupported - Whether or not this class is supported. If false,
 *   functionality will be replaced with console warnings.
 */ /**
    * A callback to run before updating the collection after active devices are changed
    *   via the public API. If this returns a Promise, the list of active devices will
    *   not be updated until it is resolved.
    * @callback OutputDeviceCollection~beforeChange
    * @param {string} name - Name of the collection.
    * @param {Array<MediaDeviceInfo>} devices - A list of MediaDeviceInfos representing the
    *   now active set of devices.
    */
function OutputDeviceCollection(name, availableDevices, beforeChange, isSupported) {
  Object.defineProperties(this, {
    _activeDevices: { value: new Set() },
    _availableDevices: { value: availableDevices },
    _beforeChange: { value: beforeChange },
    _isSupported: { value: isSupported },
    _name: { value: name }
  });
}

/**
 * Delete a device from the collection. If no devices remain, the 'default'
 *   device will be added as the sole device. If no `default` device exists,
 *   the first available device will be used.
 * @private
 * @returns {Boolean} wasDeleted
 */
OutputDeviceCollection.prototype._delete = function _delete(device) {
  var wasDeleted = this._activeDevices.delete(device);

  var defaultDevice = this._availableDevices.get('default') || Array.from(this._availableDevices.values())[0];

  if (!this._activeDevices.size && defaultDevice) {
    this._activeDevices.add(defaultDevice);
  }

  // Call _beforeChange so that the implementation can react when a device is
  // removed or lost.
  var deviceIds = Array.from(this._activeDevices).map(function (deviceInfo) {
    return deviceInfo.deviceId;
  });

  this._beforeChange(this._name, deviceIds);
  return wasDeleted;
};

/**
 * Get the current set of devices.
 * @returns {Set<MediaDeviceInfo>}
 */
OutputDeviceCollection.prototype.get = function get() {
  return this._activeDevices;
};

/**
 * Replace the current set of devices with a new set of devices.
 * @param {string|Array<string>} deviceIds - An ID or array of IDs
 *   of devices to replace the existing devices with.
 * @returns {Promise} - Rejects if this feature is not supported, any of the
 *    supplied IDs are not found, or no IDs are passed.
 */
OutputDeviceCollection.prototype.set = function set(deviceIds) {
  if (!this._isSupported) {
    return Promise.reject(new Error('This browser does not support audio output selection'));
  }

  deviceIds = Array.isArray(deviceIds) ? deviceIds : [deviceIds];

  if (!deviceIds.length) {
    return Promise.reject(new Error('Must specify at least one device to set'));
  }

  var missingIds = [];
  var devices = deviceIds.map(function (id) {
    var device = this._availableDevices.get(id);
    if (!device) {
      missingIds.push(id);
    }
    return device;
  }, this);

  if (missingIds.length) {
    return Promise.reject(new Error('Devices not found: ' + missingIds.join(', ')));
  }

  var self = this;
  function updateDevices() {
    self._activeDevices.clear();
    devices.forEach(self._activeDevices.add, self._activeDevices);
  }

  return new Promise(function (resolve) {
    resolve(self._beforeChange(self._name, deviceIds));
  }).then(updateDevices);
};

/**
 * Test the devices by playing audio through them.
 * @param {?string} [soundUrl] - An optional URL. If none is specified, we will
 *   play a default test tone.
 * @returns {Promise} Succeeds if the underlying .play() methods' Promises succeed.
 */
OutputDeviceCollection.prototype.test = function test(soundUrl) {
  if (!this._isSupported) {
    return Promise.reject(new Error('This browser does not support audio output selection'));
  }

  soundUrl = soundUrl || DEFAULT_TEST_SOUND_URL;

  if (!this._activeDevices.size) {
    return Promise.reject(new Error('No active output devices to test'));
  }

  return Promise.all(Array.from(this._activeDevices).map(function (device) {
    var el = new Audio([soundUrl]);

    return el.setSinkId(device.deviceId).then(function () {
      return el.play();
    });
  }));
};

module.exports = OutputDeviceCollection;
},{"./util":28}],12:[function(require,module,exports){
'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var log = require('./log');
var twutil = require('./util');

var WSTransport = require('./wstransport').WSTransport;

var PSTREAM_VERSION = '1.4';

/**
 * Constructor for PStream objects.
 *
 * @exports PStream as Twilio.PStream
 * @memberOf Twilio
 * @borrows EventEmitter#addListener as #addListener
 * @borrows EventEmitter#removeListener as #removeListener
 * @borrows EventEmitter#emit as #emit
 * @borrows EventEmitter#hasListener as #hasListener
 * @constructor
 * @param {string} token The Twilio capabilities JWT
 * @param {object} [options]
 * @config {boolean} [options.debug=false] Enable debugging
 */
function PStream(token, options) {
  if (!(this instanceof PStream)) {
    return new PStream(token, options);
  }
  twutil.monitorEventEmitter('Twilio.PStream', this);
  var defaults = {
    logPrefix: '[PStream]',
    chunderw: 'chunderw-vpc-gll.twilio.com',
    secureSignaling: true,
    transportFactory: WSTransport,
    debug: false
  };
  options = options || {};
  for (var prop in defaults) {
    if (prop in options) continue;
    options[prop] = defaults[prop];
  }
  this.options = options;
  this.token = token || '';
  this.status = 'disconnected';
  this.host = this.options.chunderw;
  this.gateway = null;
  this.region = null;

  log.mixinLog(this, this.options.logPrefix);
  this.log.enabled = this.options.debug;

  // NOTE(mroberts): EventEmitter requires that we catch all errors.
  this.on('error', function () {});

  /*
   *events used by device
   *'invite',
   *'ready',
   *'error',
   *'offline',
   *
   *'cancel',
   *'presence',
   *'roster',
   *'answer',
   *'candidate',
   *'hangup'
   */

  var self = this;

  this.addListener('ready', function () {
    self.status = 'ready';
  });
  this.addListener('offline', function () {
    self.status = 'offline';
  });
  this.addListener('close', function () {
    self.destroy();
  });

  var opt = {
    host: this.host,
    debug: this.options.debug,
    secureSignaling: this.options.secureSignaling
  };
  this.transport = this.options.transportFactory(opt);
  this.transport.onopen = function () {
    self.status = 'connected';
    self.setToken(self.token);
  };
  this.transport.onclose = function () {
    if (self.status !== 'disconnected') {
      if (self.status !== 'offline') {
        self.emit('offline', self);
      }
      self.status = 'disconnected';
    }
  };
  this.transport.onerror = function (err) {
    self.emit('error', err);
  };
  this.transport.onmessage = function (msg) {
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

      // emit event type and pass the payload
      self.emit(eventType, payload);
    }
  };
  this.transport.open();

  return this;
}

util.inherits(PStream, EventEmitter);

/**
 * @return {string}
 */
PStream.toString = function () {
  return '[Twilio.PStream class]';
};

PStream.prototype.toString = function () {
  return '[Twilio.PStream instance]';
};
PStream.prototype.setToken = function (token) {
  this.log('Setting token and publishing listen');
  this.token = token;
  var payload = {
    token: token,
    browserinfo: twutil.getSystemInfo()
  };
  this.publish('listen', payload);
};
PStream.prototype.register = function (mediaCapabilities) {
  var regPayload = {
    media: mediaCapabilities
  };
  this.publish('register', regPayload);
};
PStream.prototype.destroy = function () {
  this.log('Closing PStream');
  this.transport.close();
  return this;
};
PStream.prototype.publish = function (type, payload) {
  var msg = JSON.stringify({
    type: type,
    version: PSTREAM_VERSION,
    payload: payload
  });
  this.transport.send(msg);
};

exports.PStream = PStream;
},{"./log":9,"./util":28,"./wstransport":29,"events":37,"util":46}],13:[function(require,module,exports){
'use strict';

var XHR = require('xmlhttprequest').XMLHttpRequest;

function request(method, params, callback) {
  var options = {};
  options.XMLHttpRequest = options.XMLHttpRequest || XHR;
  var xhr = new options.XMLHttpRequest();

  xhr.open(method, params.url, true);
  xhr.onreadystatechange = function onreadystatechange() {
    if (xhr.readyState !== 4) {
      return;
    }

    if (200 <= xhr.status && xhr.status < 300) {
      callback(null, xhr.responseText);
      return;
    }

    callback(new Error(xhr.responseText));
  };

  for (var headerName in params.headers) {
    xhr.setRequestHeader(headerName, params.headers[headerName]);
  }

  xhr.send(JSON.stringify(params.body));
}
/**
 * Use XMLHttpRequest to get a network resource.
 * @param {String} method - HTTP Method
 * @param {Object} params - Request parameters
 * @param {String} params.url - URL of the resource
 * @param {Array}  params.headers - An array of headers to pass [{ headerName : headerBody }]
 * @param {Object} params.body - A JSON body to send to the resource
 * @returns {response}
 **/
var Request = request;

/**
 * Sugar function for request('GET', params, callback);
 * @param {Object} params - Request parameters
 * @param {Request~get} callback - The callback that handles the response.
 */
Request.get = function get(params, callback) {
  return new this('GET', params, callback);
};

/**
 * Sugar function for request('POST', params, callback);
 * @param {Object} params - Request parameters
 * @param {Request~post} callback - The callback that handles the response.
 */
Request.post = function post(params, callback) {
  return new this('POST', params, callback);
};

module.exports = Request;
},{"xmlhttprequest":2}],14:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var util = require('../util');

function getUserMedia(constraints, options) {
  options = options || {};
  options.util = options.util || util;
  options.navigator = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);

  return new Promise(function (resolve, reject) {
    if (!options.navigator) {
      throw new Error('getUserMedia is not supported');
    }

    switch ('function') {
      case _typeof(options.navigator.mediaDevices && options.navigator.mediaDevices.getUserMedia):
        return resolve(options.navigator.mediaDevices.getUserMedia(constraints));
      case _typeof(options.navigator.webkitGetUserMedia):
        return options.navigator.webkitGetUserMedia(constraints, resolve, reject);
      case _typeof(options.navigator.mozGetUserMedia):
        return options.navigator.mozGetUserMedia(constraints, resolve, reject);
      case _typeof(options.navigator.getUserMedia):
        return options.navigator.getUserMedia(constraints, resolve, reject);
      default:
        throw new Error('getUserMedia is not supported');
    }
  }).catch(function (e) {
    throw options.util.isFirefox() && e.name === 'NotReadableError' ? new Error('Firefox does not currently support opening multiple audio input tracks' + 'simultaneously, even across different tabs.\n' + 'Related Bugzilla thread: https://bugzilla.mozilla.org/show_bug.cgi?id=1299324') : e;
  });
}

module.exports = getUserMedia;
},{"../util":28}],15:[function(require,module,exports){
'use strict';

var PeerConnection = require('./peerconnection');

function enabled(set) {
  if (typeof set !== 'undefined') {
    PeerConnection.enabled = set;
  }
  return PeerConnection.enabled;
}

function getMediaEngine() {
  return typeof RTCIceGatherer !== 'undefined' ? 'ORTC' : 'WebRTC';
}

module.exports = {
  enabled: enabled,
  getMediaEngine: getMediaEngine,
  PeerConnection: PeerConnection
};
},{"./peerconnection":19}],16:[function(require,module,exports){
/**
 * This file was imported from another project. If making changes to this file, please don't
 * make them here. Make them on the linked repo below, then copy back:
 * https://code.hq.twilio.com/client/MockRTCStatsReport
 */

/* eslint-disable no-undefined */
'use strict';

// The legacy max volume, which is the positive half of a signed short integer.

var OLD_MAX_VOLUME = 32767;

var NativeRTCStatsReport = typeof window !== 'undefined' ? window.RTCStatsReport : undefined;

/**
 * Create a MockRTCStatsReport wrapper around a Map of RTCStats objects. If RTCStatsReport is available
 *   natively, it will be inherited so that instanceof checks pass.
 * @constructor
 * @extends RTCStatsReport
 * @param {Map<string, RTCStats>} statsMap - A Map of RTCStats objects to wrap
 *   with a MockRTCStatsReport object.
 */
function MockRTCStatsReport(statsMap) {
  if (!(this instanceof MockRTCStatsReport)) {
    return new MockRTCStatsReport(statsMap);
  }

  var self = this;
  Object.defineProperties(this, {
    size: {
      enumerable: true,
      get: function get() {
        return self._map.size;
      }
    },
    _map: { value: statsMap }
  });

  this[Symbol.iterator] = statsMap[Symbol.iterator];
}

// If RTCStatsReport is available natively, inherit it. Keep our constructor.
if (NativeRTCStatsReport) {
  MockRTCStatsReport.prototype = Object.create(NativeRTCStatsReport.prototype);
  MockRTCStatsReport.prototype.constructor = MockRTCStatsReport;
}

// Map the Map-like read methods to the underlying Map
['entries', 'forEach', 'get', 'has', 'keys', 'values'].forEach(function (key) {
  MockRTCStatsReport.prototype[key] = function () {
    return this._map[key].apply(this._map, arguments);
  };
});

/**
 * Convert an array of RTCStats objects into a mock RTCStatsReport object.
 * @param {Array<RTCStats>}
 * @return {MockRTCStatsReport}
 */
MockRTCStatsReport.fromArray = function fromArray(array) {
  return new MockRTCStatsReport(array.reduce(function (map, rtcStats) {
    map.set(rtcStats.id, rtcStats);
    return map;
  }, new Map()));
};

/**
 * Convert a legacy RTCStatsResponse object into a mock RTCStatsReport object.
 * @param {RTCStatsResponse} statsResponse - An RTCStatsResponse object returned by the
 *   legacy getStats(callback) method in Chrome.
 * @return {MockRTCStatsReport} A mock RTCStatsReport object.
 */
MockRTCStatsReport.fromRTCStatsResponse = function fromRTCStatsResponse(statsResponse) {
  var activeCandidatePairId;
  var transportIds = new Map();

  var statsMap = statsResponse.result().reduce(function (statsMap, report) {
    var id = report.id;
    switch (report.type) {
      case 'googCertificate':
        statsMap.set(id, createRTCCertificateStats(report));
        break;
      case 'datachannel':
        statsMap.set(id, createRTCDataChannelStats(report));
        break;
      case 'googCandidatePair':
        if (getBoolean(report, 'googActiveConnection')) {
          activeCandidatePairId = id;
        }

        statsMap.set(id, createRTCIceCandidatePairStats(report));
        break;
      case 'localcandidate':
        statsMap.set(id, createRTCIceCandidateStats(report, false));
        break;
      case 'remotecandidate':
        statsMap.set(id, createRTCIceCandidateStats(report, true));
        break;
      case 'ssrc':
        if (isPresent(report, 'packetsReceived')) {
          statsMap.set('rtp-' + id, createRTCInboundRTPStreamStats(report));
        } else {
          statsMap.set('rtp-' + id, createRTCOutboundRTPStreamStats(report));
        }

        statsMap.set('track-' + id, createRTCMediaStreamTrackStats(report));
        statsMap.set('codec-' + id, createRTCCodecStats(report));
        break;
      case 'googComponent':
        var transportReport = createRTCTransportStats(report);
        transportIds.set(transportReport.selectedCandidatePairId, id);
        statsMap.set(id, createRTCTransportStats(report));
        break;
    }

    return statsMap;
  }, new Map());

  if (activeCandidatePairId) {
    var activeTransportId = transportIds.get(activeCandidatePairId);
    if (activeTransportId) {
      statsMap.get(activeTransportId).dtlsState = 'connected';
    }
  }

  return new MockRTCStatsReport(statsMap);
};

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCTransportStats}
 */
function createRTCTransportStats(report) {
  return {
    type: 'transport',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    bytesSent: undefined,
    bytesReceived: undefined,
    rtcpTransportStatsId: undefined,
    dtlsState: undefined,
    selectedCandidatePairId: report.stat('selectedCandidatePairId'),
    localCertificateId: report.stat('localCertificateId'),
    remoteCertificateId: report.stat('remoteCertificateId')
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCCodecStats}
 */
function createRTCCodecStats(report) {
  return {
    type: 'codec',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    payloadType: undefined,
    mimeType: report.stat('mediaType') + '/' + report.stat('googCodecName'),
    clockRate: undefined,
    channels: undefined,
    sdpFmtpLine: undefined,
    implementation: undefined
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCMediaStreamTrackStats}
 */
function createRTCMediaStreamTrackStats(report) {
  return {
    type: 'track',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    trackIdentifier: report.stat('googTrackId'),
    remoteSource: undefined,
    ended: undefined,
    kind: report.stat('mediaType'),
    detached: undefined,
    ssrcIds: undefined,
    frameWidth: isPresent(report, 'googFrameWidthReceived') ? getInt(report, 'googFrameWidthReceived') : getInt(report, 'googFrameWidthSent'),
    frameHeight: isPresent(report, 'googFrameHeightReceived') ? getInt(report, 'googFrameHeightReceived') : getInt(report, 'googFrameHeightSent'),
    framesPerSecond: undefined,
    framesSent: getInt(report, 'framesEncoded'),
    framesReceived: undefined,
    framesDecoded: getInt(report, 'framesDecoded'),
    framesDropped: undefined,
    framesCorrupted: undefined,
    partialFramesLost: undefined,
    fullFramesLost: undefined,
    audioLevel: isPresent(report, 'audioOutputLevel') ? getInt(report, 'audioOutputLevel') / OLD_MAX_VOLUME : (getInt(report, 'audioInputLevel') || 0) / OLD_MAX_VOLUME,
    echoReturnLoss: getFloat(report, 'googEchoCancellationReturnLoss'),
    echoReturnLossEnhancement: getFloat(report, 'googEchoCancellationReturnLossEnhancement')
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @param {boolean} isInbound - Whether to create an inbound stats object, or outbound.
 * @returns {RTCRTPStreamStats}
 */
function createRTCRTPStreamStats(report, isInbound) {
  return {
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    ssrc: report.stat('ssrc'),
    associateStatsId: undefined,
    isRemote: undefined,
    mediaType: report.stat('mediaType'),
    trackId: 'track-' + report.id,
    transportId: report.stat('transportId'),
    codecId: 'codec-' + report.id,
    firCount: isInbound ? getInt(report, 'googFirsSent') : undefined,
    pliCount: isInbound ? getInt(report, 'googPlisSent') : getInt(report, 'googPlisReceived'),
    nackCount: isInbound ? getInt(report, 'googNacksSent') : getInt(report, 'googNacksReceived'),
    sliCount: undefined,
    qpSum: getInt(report, 'qpSum')
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCInboundRTPStreamStats}
 */
function createRTCInboundRTPStreamStats(report) {
  var rtp = createRTCRTPStreamStats(report, true);

  Object.assign(rtp, {
    type: 'inbound-rtp',
    packetsReceived: getInt(report, 'packetsReceived'),
    bytesReceived: getInt(report, 'bytesReceived'),
    packetsLost: getInt(report, 'packetsLost'),
    jitter: convertMsToSeconds(report.stat('googJitterReceived')),
    fractionLost: undefined,
    roundTripTime: convertMsToSeconds(report.stat('googRtt')),
    packetsDiscarded: undefined,
    packetsRepaired: undefined,
    burstPacketsLost: undefined,
    burstPacketsDiscarded: undefined,
    burstLossCount: undefined,
    burstDiscardCount: undefined,
    burstLossRate: undefined,
    burstDiscardRate: undefined,
    gapLossRate: undefined,
    gapDiscardRate: undefined,
    framesDecoded: getInt(report, 'framesDecoded')
  });

  return rtp;
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCOutboundRTPStreamStats}
 */
function createRTCOutboundRTPStreamStats(report) {
  var rtp = createRTCRTPStreamStats(report, false);

  Object.assign(rtp, {
    type: 'outbound-rtp',
    remoteTimestamp: undefined,
    packetsSent: getInt(report, 'packetsSent'),
    bytesSent: getInt(report, 'bytesSent'),
    targetBitrate: undefined,
    framesEncoded: getInt(report, 'framesEncoded')
  });

  return rtp;
}

/**
 * @param {RTCLegacyStatsReport} report
 * @param {boolean} isRemote - Whether to create for a remote candidate, or local candidate.
 * @returns {RTCIceCandidateStats}
 */
function createRTCIceCandidateStats(report, isRemote) {
  return {
    type: isRemote ? 'remote-candidate' : 'local-candidate',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    transportId: undefined,
    isRemote: isRemote,
    ip: report.stat('ipAddress'),
    port: getInt(report, 'portNumber'),
    protocol: report.stat('transport'),
    candidateType: translateCandidateType(report.stat('candidateType')),
    priority: getFloat(report, 'priority'),
    url: undefined,
    relayProtocol: undefined,
    deleted: undefined
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCIceCandidatePairStats}
 */
function createRTCIceCandidatePairStats(report) {
  return {
    type: 'candidate-pair',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    transportId: report.stat('googChannelId'),
    localCandidateId: report.stat('localCandidateId'),
    remoteCandidateId: report.stat('remoteCandidateId'),
    state: undefined,
    priority: undefined,
    nominated: undefined,
    writable: getBoolean(report, 'googWritable'),
    readable: undefined,
    bytesSent: getInt(report, 'bytesSent'),
    bytesReceived: getInt(report, 'bytesReceived'),
    lastPacketSentTimestamp: undefined,
    lastPacketReceivedTimestamp: undefined,
    totalRoundTripTime: undefined,
    currentRoundTripTime: convertMsToSeconds(report.stat('googRtt')),
    availableOutgoingBitrate: undefined,
    availableIncomingBitrate: undefined,
    requestsReceived: getInt(report, 'requestsReceived'),
    requestsSent: getInt(report, 'requestsSent'),
    responsesReceived: getInt(report, 'responsesReceived'),
    responsesSent: getInt(report, 'responsesSent'),
    retransmissionsReceived: undefined,
    retransmissionsSent: undefined,
    consentRequestsSent: getInt(report, 'consentRequestsSent')
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCIceCertificateStats}
 */
function createRTCCertificateStats(report) {
  return {
    type: 'certificate',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    fingerprint: report.stat('googFingerprint'),
    fingerprintAlgorithm: report.stat('googFingerprintAlgorithm'),
    base64Certificate: report.stat('googDerBase64'),
    issuerCertificateId: report.stat('googIssuerId')
  };
}

/**
 * @param {RTCLegacyStatsReport} report
 * @returns {RTCDataChannelStats}
 */
function createRTCDataChannelStats(report) {
  return {
    type: 'data-channel',
    id: report.id,
    timestamp: Date.parse(report.timestamp),
    label: report.stat('label'),
    protocol: report.stat('protocol'),
    datachannelid: report.stat('datachannelid'),
    transportId: report.stat('transportId'),
    state: report.stat('state'),
    messagesSent: undefined,
    bytesSent: undefined,
    messagesReceived: undefined,
    bytesReceived: undefined
  };
}

/**
 * @param {number} inMs - A time in milliseconds
 * @returns {number} The time in seconds
 */
function convertMsToSeconds(inMs) {
  return isNaN(inMs) || inMs === '' ? undefined : parseInt(inMs, 10) / 1000;
}

/**
 * @param {string} type - A type in the legacy format
 * @returns {string} The type adjusted to new standards for known naming changes
 */
function translateCandidateType(type) {
  switch (type) {
    case 'peerreflexive':
      return 'prflx';
    case 'serverreflexive':
      return 'srflx';
    case 'host':
    case 'relay':
    default:
      return type;
  }
}

function getInt(report, statName) {
  var stat = report.stat(statName);
  return isPresent(report, statName) ? parseInt(stat, 10) : undefined;
}

function getFloat(report, statName) {
  var stat = report.stat(statName);
  return isPresent(report, statName) ? parseFloat(stat) : undefined;
}

function getBoolean(report, statName) {
  var stat = report.stat(statName);
  return isPresent(report, statName) ? stat === 'true' || stat === true : undefined;
}

function isPresent(report, statName) {
  var stat = report.stat(statName);
  return typeof stat !== 'undefined' && stat !== '';
}

module.exports = MockRTCStatsReport;
},{}],17:[function(require,module,exports){
'use strict';

var EventEmitter = require('events').EventEmitter;
var getStatistics = require('./stats');
var inherits = require('util').inherits;
var Mos = require('./mos');

// How many samples we use when testing metric thresholds
var SAMPLE_COUNT_METRICS = 5;

// How many samples that need to cross the threshold to
// raise or clear a warning.
var SAMPLE_COUNT_CLEAR = 0;
var SAMPLE_COUNT_RAISE = 3;

var SAMPLE_INTERVAL = 1000;
var WARNING_TIMEOUT = 5 * 1000;

/**
 * @typedef {Object} RTCMonitor.ThresholdOptions
 * @property {RTCMonitor.ThresholdOption} [audioInputLevel] - Rules to apply to sample.audioInputLevel
 * @property {RTCMonitor.ThresholdOption} [audioOutputLevel] - Rules to apply to sample.audioOutputLevel
 * @property {RTCMonitor.ThresholdOption} [packetsLostFraction] - Rules to apply to sample.packetsLostFraction
 * @property {RTCMonitor.ThresholdOption} [jitter] - Rules to apply to sample.jitter
 * @property {RTCMonitor.ThresholdOption} [rtt] - Rules to apply to sample.rtt
 * @property {RTCMonitor.ThresholdOption} [mos] - Rules to apply to sample.mos
 */ /**
    * @typedef {Object} RTCMonitor.ThresholdOption
    * @property {?Number} [min] - Warning will be raised if tracked metric falls below this value.
    * @property {?Number} [max] - Warning will be raised if tracked metric rises above this value.
    * @property {?Number} [maxDuration] - Warning will be raised if tracked metric stays constant for
    *   the specified number of consequent samples.
    */
var DEFAULT_THRESHOLDS = {
  audioInputLevel: { maxDuration: 10 },
  audioOutputLevel: { maxDuration: 10 },
  packetsLostFraction: { max: 1 },
  jitter: { max: 30 },
  rtt: { max: 400 },
  mos: { min: 3 }
};

/**
 * RTCMonitor polls a peerConnection via PeerConnection.getStats
 * and emits warnings when stats cross the specified threshold values.
 * @constructor
 * @param {RTCMonitor.Options} [options] - Config options for RTCMonitor.
 */ /**
    * @typedef {Object} RTCMonitor.Options
    * @property {PeerConnection} [peerConnection] - The PeerConnection to monitor.
    * @property {RTCMonitor.ThresholdOptions} [thresholds] - Optional custom threshold values.
    */
function RTCMonitor(options) {
  if (!(this instanceof RTCMonitor)) {
    return new RTCMonitor(options);
  }

  options = options || {};
  var thresholds = Object.assign({}, DEFAULT_THRESHOLDS, options.thresholds);

  Object.defineProperties(this, {
    _activeWarnings: { value: new Map() },
    _currentStreaks: { value: new Map() },
    _peerConnection: { value: options.peerConnection, writable: true },
    _sampleBuffer: { value: [] },
    _sampleInterval: { value: null, writable: true },
    _thresholds: { value: thresholds },
    _warningsEnabled: { value: true, writable: true }
  });

  if (options.peerConnection) {
    this.enable();
  }

  EventEmitter.call(this);
}

inherits(RTCMonitor, EventEmitter);

/**
 * Create a sample object from a stats object using the previous sample,
 *   if available.
 * @param {Object} stats - Stats retrieved from getStatistics
 * @param {?Object} [previousSample=null] - The previous sample to use to calculate deltas.
 * @returns {Promise<RTCSample>}
 */
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

/**
 * Start sampling RTC statistics for this {@link RTCMonitor}.
 * @param {PeerConnection} [peerConnection] - A PeerConnection to monitor.
 * @throws {Error} Attempted to replace an existing PeerConnection in RTCMonitor.enable
 * @throws {Error} Can not enable RTCMonitor without a PeerConnection
 * @returns {RTCMonitor} This RTCMonitor instance.
 */
RTCMonitor.prototype.enable = function enable(peerConnection) {
  if (peerConnection) {
    if (this._peerConnection && peerConnection !== this._peerConnection) {
      throw new Error('Attempted to replace an existing PeerConnection in RTCMonitor.enable');
    }

    this._peerConnection = peerConnection;
  }

  if (!this._peerConnection) {
    throw new Error('Can not enable RTCMonitor without a PeerConnection');
  }

  this._sampleInterval = this._sampleInterval || setInterval(this._fetchSample.bind(this), SAMPLE_INTERVAL);

  return this;
};

/**
 * Stop sampling RTC statistics for this {@link RTCMonitor}.
 * @returns {RTCMonitor} This RTCMonitor instance.
 */
RTCMonitor.prototype.disable = function disable() {
  clearInterval(this._sampleInterval);
  this._sampleInterval = null;

  return this;
};

/**
 * Get stats from the PeerConnection.
 * @returns {Promise<RTCSample>} A universally-formatted version of RTC stats.
 */
RTCMonitor.prototype.getSample = function getSample() {
  var pc = this._peerConnection;
  var self = this;

  return getStatistics(pc).then(function (stats) {
    var previousSample = self._sampleBuffer.length && self._sampleBuffer[self._sampleBuffer.length - 1];

    return RTCMonitor.createSample(stats, previousSample);
  });
};

/**
 * Get stats from the PeerConnection and add it to our list of samples.
 * @private
 * @returns {Promise<Object>} A universally-formatted version of RTC stats.
 */
RTCMonitor.prototype._fetchSample = function _fetchSample() {
  var self = this;

  return this.getSample().then(function addSample(sample) {
    self._addSample(sample);
    self._raiseWarnings();
    self.emit('sample', sample);
    return sample;
  }, function getSampleFailed(error) {
    self.disable();
    self.emit('error', error);
  });
};

/**
 * Add a sample to our sample buffer and remove the oldest if
 *   we are over the limit.
 * @private
 * @param {Object} sample - Sample to add
 */
RTCMonitor.prototype._addSample = function _addSample(sample) {
  var samples = this._sampleBuffer;
  samples.push(sample);

  // We store 1 extra sample so that we always have (current, previous)
  // available for all {sampleBufferSize} threshold validations.
  if (samples.length > SAMPLE_COUNT_METRICS) {
    samples.splice(0, samples.length - SAMPLE_COUNT_METRICS);
  }
};

/**
 * Apply our thresholds to our array of RTCStat samples.
 * @private
 */
RTCMonitor.prototype._raiseWarnings = function _raiseWarnings() {
  if (!this._warningsEnabled) {
    return;
  }

  for (var name in this._thresholds) {
    this._raiseWarningsForStat(name);
  }
};

/**
 * Enable warning functionality.
 * @returns {RTCMonitor}
 */
RTCMonitor.prototype.enableWarnings = function enableWarnings() {
  this._warningsEnabled = true;
  return this;
};

/**
 * Disable warning functionality.
 * @returns {RTCMonitor}
 */
RTCMonitor.prototype.disableWarnings = function disableWarnings() {
  if (this._warningsEnabled) {
    this._activeWarnings.clear();
  }

  this._warningsEnabled = false;
  return this;
};

/**
 * Apply thresholds for a given stat name to our array of
 *   RTCStat samples and raise or clear any associated warnings.
 * @private
 * @param {String} statName - Name of the stat to compare.
 */
RTCMonitor.prototype._raiseWarningsForStat = function _raiseWarningsForStat(statName) {
  var samples = this._sampleBuffer;
  var limits = this._thresholds[statName];

  var relevantSamples = samples.slice(-SAMPLE_COUNT_METRICS);
  var values = relevantSamples.map(function (sample) {
    return sample[statName];
  });

  // (rrowland) If we have a bad or missing value in the set, we don't
  // have enough information to throw or clear a warning. Bail out.
  var containsNull = values.some(function (value) {
    return typeof value === 'undefined' || value === null;
  });

  if (containsNull) {
    return;
  }

  var count;
  if (typeof limits.max === 'number') {
    count = countHigh(limits.max, values);
    if (count >= SAMPLE_COUNT_RAISE) {
      this._raiseWarning(statName, 'max', { values: values });
    } else if (count <= SAMPLE_COUNT_CLEAR) {
      this._clearWarning(statName, 'max', { values: values });
    }
  }

  if (typeof limits.min === 'number') {
    count = countLow(limits.min, values);
    if (count >= SAMPLE_COUNT_RAISE) {
      this._raiseWarning(statName, 'min', { values: values });
    } else if (count <= SAMPLE_COUNT_CLEAR) {
      this._clearWarning(statName, 'min', { values: values });
    }
  }

  if (typeof limits.maxDuration === 'number' && samples.length > 1) {
    relevantSamples = samples.slice(-2);
    var prevValue = relevantSamples[0][statName];
    var curValue = relevantSamples[1][statName];

    var prevStreak = this._currentStreaks.get(statName) || 0;
    var streak = prevValue === curValue ? prevStreak + 1 : 0;

    this._currentStreaks.set(statName, streak);

    if (streak >= limits.maxDuration) {
      this._raiseWarning(statName, 'maxDuration', { value: streak });
    } else if (streak === 0) {
      this._clearWarning(statName, 'maxDuration', { value: prevStreak });
    }
  }
};

/**
 * Count the number of values that cross the min threshold.
 * @private
 * @param {Number} min - The minimum allowable value.
 * @param {Array<Number>} values - The values to iterate over.
 * @returns {Number} The amount of values in which the stat
 *   crossed the threshold.
 */
function countLow(min, values) {
  return values.reduce(function (lowCount, value) {
    // eslint-disable-next-line no-return-assign
    return lowCount += value < min ? 1 : 0;
  }, 0);
}

/**
 * Count the number of values that cross the max threshold.
 * @private
 * @param {Number} max - The max allowable value.
 * @param {Array<Number>} values - The values to iterate over.
 * @returns {Number} The amount of values in which the stat
 *   crossed the threshold.
 */
function countHigh(max, values) {
  return values.reduce(function (highCount, value) {
    // eslint-disable-next-line no-return-assign
    return highCount += value > max ? 1 : 0;
  }, 0);
}

/**
 * Clear an active warning.
 * @param {String} statName - The name of the stat to clear.
 * @param {String} thresholdName - The name of the threshold to clear
 * @param {?Object} [data] - Any relevant sample data.
 * @private
 */
RTCMonitor.prototype._clearWarning = function _clearWarning(statName, thresholdName, data) {
  var warningId = statName + ':' + thresholdName;
  var activeWarning = this._activeWarnings.get(warningId);

  if (!activeWarning || Date.now() - activeWarning.timeRaised < WARNING_TIMEOUT) {
    return;
  }
  this._activeWarnings.delete(warningId);

  this.emit('warning-cleared', Object.assign({
    name: statName,
    threshold: {
      name: thresholdName,
      value: this._thresholds[statName][thresholdName]
    }
  }, data));
};

/**
 * Raise a warning and log its raised time.
 * @param {String} statName - The name of the stat to raise.
 * @param {String} thresholdName - The name of the threshold to raise
 * @param {?Object} [data] - Any relevant sample data.
 * @private
 */
RTCMonitor.prototype._raiseWarning = function _raiseWarning(statName, thresholdName, data) {
  var warningId = statName + ':' + thresholdName;

  if (this._activeWarnings.has(warningId)) {
    return;
  }
  this._activeWarnings.set(warningId, { timeRaised: Date.now() });

  this.emit('warning', Object.assign({
    name: statName,
    threshold: {
      name: thresholdName,
      value: this._thresholds[statName][thresholdName]
    }
  }, data));
};

module.exports = RTCMonitor;
},{"./mos":18,"./stats":21,"events":37,"util":46}],18:[function(require,module,exports){
'use strict';

var rfactorConstants = {
  r0: 94.768,
  is: 1.42611
};

/**
 * Calculate the mos score of a stats object
 * @param {object} sample - Sample, must have rtt and jitter
 * @param {number} fractionLost - The fraction of packets that have been lost
     Calculated by packetsLost / totalPackets
 * @return {number} mos - Calculated MOS, 1.0 through roughly 4.5
 */
function calcMos(sample, fractionLost) {
  if (!sample || !isPositiveNumber(sample.rtt) || !isPositiveNumber(sample.jitter) || !isPositiveNumber(fractionLost)) {
    return null;
  }

  var rFactor = calculateRFactor(sample.rtt, sample.jitter, fractionLost);

  var mos = 1 + 0.035 * rFactor + 0.000007 * rFactor * (rFactor - 60) * (100 - rFactor);

  // Make sure MOS is in range
  var isValid = mos >= 1.0 && mos < 4.6;
  return isValid ? mos : null;
}

function calculateRFactor(rtt, jitter, fractionLost) {
  var effectiveLatency = rtt + jitter * 2 + 10;
  var rFactor = 0;

  switch (true) {
    case effectiveLatency < 160:
      rFactor = rfactorConstants.r0 - effectiveLatency / 40;
      break;
    case effectiveLatency < 1000:
      rFactor = rfactorConstants.r0 - (effectiveLatency - 120) / 10;
      break;
    case effectiveLatency >= 1000:
      rFactor = rfactorConstants.r0 - effectiveLatency / 100;
      break;
  }

  var multiplier = .01;
  switch (true) {
    case fractionLost === -1:
      multiplier = 0;
      rFactor = 0;
      break;
    case fractionLost <= rFactor / 2.5:
      multiplier = 2.5;
      break;
    case fractionLost > rFactor / 2.5 && fractionLost < 100:
      multiplier = .25;
      break;
  }

  rFactor -= fractionLost * multiplier;
  return rFactor;
}

function isPositiveNumber(n) {
  return typeof n === 'number' && !isNaN(n) && isFinite(n) && n >= 0;
}

module.exports = {
  calculate: calcMos
};
},{}],19:[function(require,module,exports){
'use strict';

var Log = require('../log');
var StateMachine = require('../statemachine');
var util = require('../util');
var RTCPC = require('./rtcpc');

// Refer to <http://www.w3.org/TR/2015/WD-webrtc-20150210/#rtciceconnectionstate-enum>.
var ICE_CONNECTION_STATES = {
  new: ['checking', 'closed'],
  checking: ['new', 'connected', 'failed', 'closed',
  // Not in the spec, but Chrome can go to completed.
  'completed'],
  connected: ['new', 'disconnected', 'completed', 'closed'],
  completed: ['new', 'disconnected', 'closed',
  // Not in the spec, but Chrome can go to completed.
  'completed'],
  failed: ['new', 'disconnected', 'closed'],
  disconnected: ['connected', 'completed', 'failed', 'closed'],
  closed: []
};

var INITIAL_ICE_CONNECTION_STATE = 'new';

// These differ slightly from the normal WebRTC state transitions: since we
// never expect the 'have-local-pranswer' or 'have-remote-pranswer' states, we
// filter them out.
var SIGNALING_STATES = {
  stable: ['have-local-offer', 'have-remote-offer', 'closed'],
  'have-local-offer': ['stable', 'closed'],
  'have-remote-offer': ['stable', 'closed'],
  closed: []
};

var INITIAL_SIGNALING_STATE = 'stable';

/**
 * @typedef {Object} PeerConnection
 * @param device
 * @param options
 * @return {PeerConnection}
 * @constructor
 */
function PeerConnection(device, getUserMedia, options) {
  if (!device || !getUserMedia) {
    throw new Error('Device and getUserMedia are required arguments');
  }

  if (!(this instanceof PeerConnection)) {
    return new PeerConnection(device, getUserMedia, options);
  }

  function noop() {}
  this.onopen = noop;
  this.onerror = noop;
  this.onclose = noop;
  this.ondisconnect = noop;
  this.onreconnect = noop;
  this.onsignalingstatechange = noop;
  this.oniceconnectionstatechange = noop;
  this.onicecandidate = noop;
  this.onvolume = noop;
  this.version = null;
  this.pstream = device.stream;
  this.stream = null;
  this.sinkIds = new Set(['default']);
  this.outputs = new Map();
  this.status = 'connecting';
  this.callSid = null;
  this.isMuted = false;
  this.getUserMedia = getUserMedia;

  var AudioContext = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  this._isSinkSupported = !!AudioContext && typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype.setSinkId;
  // NOTE(mmalavalli): Since each Connection creates its own AudioContext,
  // after 6 instances an exception is thrown. Refer https://www.w3.org/2011/audio/track/issues/3.
  // In order to get around it, we are re-using the Device's AudioContext.
  this._audioContext = AudioContext && device.audio._audioContext;
  this._masterAudio = null;
  this._masterAudioDeviceId = null;
  this._mediaStreamSource = null;
  this._dtmfSender = null;
  this._dtmfSenderUnsupported = false;
  this._callEvents = [];
  this._nextTimeToPublish = Date.now();
  this._onAnswerOrRinging = noop;
  this._remoteStream = null;
  this._shouldManageStream = true;
  Log.mixinLog(this, '[Twilio.PeerConnection]');
  this.log.enabled = device.options.debug;
  this.log.warnings = device.options.warnings;

  this._iceConnectionStateMachine = new StateMachine(ICE_CONNECTION_STATES, INITIAL_ICE_CONNECTION_STATE);
  this._signalingStateMachine = new StateMachine(SIGNALING_STATES, INITIAL_SIGNALING_STATE);

  this.options = options = options || {};
  this.navigator = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  this.util = options.util || util;

  return this;
}

PeerConnection.prototype.uri = function () {
  return this._uri;
};

/**
 * Open the underlying RTCPeerConnection with a MediaStream obtained by
 *   passed constraints. The resulting MediaStream is created internally
 *   and will therefore be managed and destroyed internally.
 * @param {MediaStreamConstraints} constraints
 */
PeerConnection.prototype.openWithConstraints = function (constraints) {
  return this.getUserMedia({ audio: constraints }).then(this._setInputTracksFromStream.bind(this, false));
};

/**
 * Replace the existing input audio tracks with the audio tracks from the
 *   passed input audio stream. We re-use the existing stream because
 *   the AnalyzerNode is bound to the stream.
 * @param {MediaStream} stream
 */
PeerConnection.prototype.setInputTracksFromStream = function (stream) {
  var self = this;
  return this._setInputTracksFromStream(true, stream).then(function () {
    self._shouldManageStream = false;
  });
};

PeerConnection.prototype._createAnalyser = function (stream, audioContext) {
  var analyser = audioContext.createAnalyser();
  analyser.fftSize = 32;
  analyser.smoothingTimeConstant = 0.3;

  var streamSource = audioContext.createMediaStreamSource(stream);
  streamSource.connect(analyser);

  return analyser;
};

PeerConnection.prototype._setVolumeHandler = function (handler) {
  this.onvolume = handler;
};
PeerConnection.prototype._startPollingVolume = function () {
  if (!this._audioContext || !this.stream || !this._remoteStream) {
    return;
  }

  var audioContext = this._audioContext;

  var inputAnalyser = this._inputAnalyser = this._createAnalyser(this.stream, audioContext);
  var inputBufferLength = inputAnalyser.frequencyBinCount;
  var inputDataArray = new Uint8Array(inputBufferLength);

  var outputAnalyser = this._outputAnalyser = this._createAnalyser(this._remoteStream, audioContext);
  var outputBufferLength = outputAnalyser.frequencyBinCount;
  var outputDataArray = new Uint8Array(outputBufferLength);

  var self = this;
  requestAnimationFrame(function emitVolume() {
    if (!self._audioContext) {
      return;
    } else if (self.status === 'closed') {
      self._inputAnalyser.disconnect();
      self._outputAnalyser.disconnect();
      return;
    }

    self._inputAnalyser.getByteFrequencyData(inputDataArray);
    var inputVolume = self.util.average(inputDataArray);

    self._outputAnalyser.getByteFrequencyData(outputDataArray);
    var outputVolume = self.util.average(outputDataArray);

    self.onvolume(inputVolume / 255, outputVolume / 255);

    requestAnimationFrame(emitVolume);
  });
};

PeerConnection.prototype._stopStream = function _stopStream(stream) {
  // We shouldn't stop the tracks if they were not created inside
  //   this PeerConnection.
  if (!this._shouldManageStream) {
    return;
  }

  if (typeof MediaStreamTrack.prototype.stop === 'function') {
    var audioTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : stream.audioTracks;
    audioTracks.forEach(function (track) {
      track.stop();
    });
  }
  // NOTE(mroberts): This is just a fallback to any ancient browsers that may
  // not implement MediaStreamTrack.stop.
  else {
      stream.stop();
    }
};

/**
 * Replace the tracks of the current stream with new tracks. We do this rather than replacing the
 *   whole stream because AnalyzerNodes are bound to a stream.
 * @param {Boolean} shouldClone - Whether the stream should be cloned if it is the first
 *   stream, or set directly. As a rule of thumb, streams that are passed in externally may have
 *   their lifecycle managed externally, and should be cloned so that we do not tear it or its tracks
 *   down when the call ends. Streams that we create internally (inside PeerConnection) should be set
 *   directly so that when the call ends it is disposed of.
 * @param {MediaStream} newStream - The new stream to copy the tracks over from.
 * @private
 */
PeerConnection.prototype._setInputTracksFromStream = function (shouldClone, newStream) {
  var self = this;

  if (!newStream) {
    return Promise.reject(new Error('Can not set input stream to null while in a call'));
  }

  if (!newStream.getAudioTracks().length) {
    return Promise.reject(new Error('Supplied input stream has no audio tracks'));
  }

  var localStream = this.stream;

  if (!localStream) {
    // We can't use MediaStream.clone() here because it stopped copying over tracks
    //   as of Chrome 61. https://bugs.chromium.org/p/chromium/issues/detail?id=770908
    this.stream = shouldClone ? cloneStream(newStream) : newStream;
  } else {
    this._stopStream(localStream);

    removeStream(this.version.pc, localStream);
    localStream.getAudioTracks().forEach(localStream.removeTrack, localStream);
    newStream.getAudioTracks().forEach(localStream.addTrack, localStream);
    addStream(this.version.pc, newStream);
  }

  // Apply mute settings to new input track
  this.mute(this.isMuted);

  if (!this.version) {
    return Promise.resolve(this.stream);
  }

  return new Promise(function (resolve, reject) {
    self.version.createOffer({ audio: true }, function onOfferSuccess() {
      self.version.processAnswer(self._answerSdp, function () {
        if (self._audioContext) {
          self._inputAnalyser = self._createAnalyser(self.stream, self._audioContext);
        }
        resolve(self.stream);
      }, reject);
    }, reject);
  });
};

PeerConnection.prototype._onInputDevicesChanged = function () {
  if (!this.stream) {
    return;
  }

  // If all of our active tracks are ended, then our active input was lost
  var activeInputWasLost = this.stream.getAudioTracks().every(function (track) {
    return track.readyState === 'ended';
  });

  // We only want to act if we manage the stream in PeerConnection (It was created
  // here, rather than passed in.)
  if (activeInputWasLost && this._shouldManageStream) {
    this.openWithConstraints(true);
  }
};

PeerConnection.prototype._setSinkIds = function (sinkIds) {
  if (!this._isSinkSupported) {
    return Promise.reject(new Error('Audio output selection is not supported by this browser'));
  }

  this.sinkIds = new Set(sinkIds.forEach ? sinkIds : [sinkIds]);
  return this.version ? this._updateAudioOutputs() : Promise.resolve();
};

PeerConnection.prototype._updateAudioOutputs = function updateAudioOutputs() {
  var addedOutputIds = Array.from(this.sinkIds).filter(function (id) {
    return !this.outputs.has(id);
  }, this);

  var removedOutputIds = Array.from(this.outputs.keys()).filter(function (id) {
    return !this.sinkIds.has(id);
  }, this);

  var self = this;
  var createOutputPromises = addedOutputIds.map(this._createAudioOutput, this);
  return Promise.all(createOutputPromises).then(function () {
    return Promise.all(removedOutputIds.map(self._removeAudioOutput, self));
  });
};

PeerConnection.prototype._createAudio = function createAudio(arr) {
  return new Audio(arr);
};

PeerConnection.prototype._createAudioOutput = function createAudioOutput(id) {
  var dest = this._audioContext.createMediaStreamDestination();
  this._mediaStreamSource.connect(dest);

  var audio = this._createAudio();
  setAudioSource(audio, dest.stream);

  var self = this;
  return audio.setSinkId(id).then(function () {
    return audio.play();
  }).then(function () {
    self.outputs.set(id, {
      audio: audio,
      dest: dest
    });
  });
};

PeerConnection.prototype._removeAudioOutputs = function removeAudioOutputs() {
  return Array.from(this.outputs.keys()).map(this._removeAudioOutput, this);
};

PeerConnection.prototype._disableOutput = function disableOutput(pc, id) {
  var output = pc.outputs.get(id);
  if (!output) {
    return;
  }

  if (output.audio) {
    output.audio.pause();
    output.audio.src = '';
  }

  if (output.dest) {
    output.dest.disconnect();
  }
};

/**
 * Disable a non-master output, and update the master output to assume its state. This
 *   is called when the device ID assigned to the master output has been removed from
 *   active devices. We can not simply remove the master audio output, so we must
 *   instead reassign it.
 * @private
 * @param {PeerConnection} pc
 * @param {string} masterId - The current device ID assigned to the master audio element.
 */
PeerConnection.prototype._reassignMasterOutput = function reassignMasterOutput(pc, masterId) {
  var masterOutput = pc.outputs.get(masterId);
  pc.outputs.delete(masterId);

  var self = this;
  var idToReplace = Array.from(pc.outputs.keys())[0] || 'default';
  return masterOutput.audio.setSinkId(idToReplace).then(function () {
    self._disableOutput(pc, idToReplace);

    pc.outputs.set(idToReplace, masterOutput);
    pc._masterAudioDeviceId = idToReplace;
  }).catch(function rollback(reason) {
    pc.outputs.set(masterId, masterOutput);
    throw reason;
  });
};

PeerConnection.prototype._removeAudioOutput = function removeAudioOutput(id) {
  if (this._masterAudioDeviceId === id) {
    return this._reassignMasterOutput(this, id);
  }

  this._disableOutput(this, id);
  this.outputs.delete(id);

  return Promise.resolve();
};

/**
 * Use an AudioContext to potentially split our audio output stream to multiple
 *   audio devices. This is only available to browsers with AudioContext and
 *   HTMLAudioElement.setSinkId() available. We save the source stream in
 *   _masterAudio, and use it for one of the active audio devices. We keep
 *   track of its ID because we must replace it if we lose its initial device.
 */
PeerConnection.prototype._onAddTrack = function onAddTrack(pc, stream) {
  var audio = pc._masterAudio = this._createAudio();
  setAudioSource(audio, stream);
  audio.play();

  // Assign the initial master audio element to a random active output device
  var deviceId = Array.from(pc.outputs.keys())[0] || 'default';
  pc._masterAudioDeviceId = deviceId;
  pc.outputs.set(deviceId, {
    audio: audio
  });

  pc._mediaStreamSource = pc._audioContext.createMediaStreamSource(stream);

  pc.pcStream = stream;
  pc._updateAudioOutputs();
};

/**
 * Use a single audio element to play the audio output stream. This does not
 *   support multiple output devices, and is a fallback for when AudioContext
 *   and/or HTMLAudioElement.setSinkId() is not available to the client.
 */
PeerConnection.prototype._fallbackOnAddTrack = function fallbackOnAddTrack(pc, stream) {
  var audio = document && document.createElement('audio');
  audio.autoplay = true;

  if (!setAudioSource(audio, stream)) {
    pc.log('Error attaching stream to element.');
  }

  pc.outputs.set('default', {
    audio: audio
  });
};

PeerConnection.prototype._setupPeerConnection = function (rtcConstraints, iceServers) {
  var self = this;
  var version = this._getProtocol();
  version.create(this.log, rtcConstraints, iceServers);
  addStream(version.pc, this.stream);

  var eventName = 'ontrack' in version.pc ? 'ontrack' : 'onaddstream';

  version.pc[eventName] = function (event) {
    var stream = self._remoteStream = event.stream || event.streams[0];

    if (self._isSinkSupported) {
      self._onAddTrack(self, stream);
    } else {
      self._fallbackOnAddTrack(self, stream);
    }

    self._startPollingVolume();
  };
  return version;
};
PeerConnection.prototype._setupChannel = function () {
  var self = this;
  var pc = this.version.pc;

  // Chrome 25 supports onopen
  self.version.pc.onopen = function () {
    self.status = 'open';
    self.onopen();
  };

  // Chrome 26 doesn't support onopen so must detect state change
  self.version.pc.onstatechange = function () {
    if (self.version.pc && self.version.pc.readyState === 'stable') {
      self.status = 'open';
      self.onopen();
    }
  };

  // Chrome 27 changed onstatechange to onsignalingstatechange
  self.version.pc.onsignalingstatechange = function () {
    var state = pc.signalingState;
    self.log('signalingState is "' + state + '"');

    // Update our internal state machine.
    try {
      self._signalingStateMachine.transition(state);
    } catch (error) {
      self.log('Failed to transition to signaling state ' + state + ': ' + error);
    }

    if (self.version.pc && self.version.pc.signalingState === 'stable') {
      self.status = 'open';
      self.onopen();
    }

    self.onsignalingstatechange(pc.signalingState);
  };

  pc.onicecandidate = function onicecandidate(event) {
    self.onicecandidate(event.candidate);
  };

  pc.oniceconnectionstatechange = function () {
    var state = pc.iceConnectionState;
    // Grab our previous state to help determine cause of state change
    var previousState = self._iceConnectionStateMachine.currentState;

    // Update our internal state machine.
    try {
      self._iceConnectionStateMachine.transition(state);
    } catch (error) {
      self.log('Failed to transition to ice connection state ' + state + ': ' + error);
    }

    var message;
    switch (state) {
      case 'connected':
        if (previousState === 'disconnected') {
          message = 'ICE liveliness check succeeded. Connection with Twilio restored';
          self.log(message);
          self.onreconnect(message);
        }
        break;
      case 'disconnected':
        message = 'ICE liveliness check failed. May be having trouble connecting to Twilio';
        self.log(message);
        self.ondisconnect(message);
        break;
      case 'failed':
        // Takes care of checking->failed and disconnected->failed
        message = (previousState === 'checking' ? 'ICE negotiation with Twilio failed.' : 'Connection with Twilio was interrupted.') + ' Call will terminate.';

        self.log(message);
        self.onerror({
          info: {
            code: 31003,
            message: message
          },
          disconnect: true
        });
        break;
      default:
        self.log('iceConnectionState is "' + state + '"');
    }

    self.oniceconnectionstatechange(state);
  };
};
PeerConnection.prototype._initializeMediaStream = function (rtcConstraints, iceServers) {
  // if mediastream already open then do nothing
  if (this.status === 'open') {
    return false;
  }
  if (this.pstream.status === 'disconnected') {
    this.onerror({ info: {
        code: 31000,
        message: 'Cannot establish connection. Client is disconnected'
      } });
    this.close();
    return false;
  }
  this.version = this._setupPeerConnection(rtcConstraints, iceServers);
  this._setupChannel();
  return true;
};
PeerConnection.prototype.makeOutgoingCall = function (token, params, callsid, rtcConstraints, iceServers, onMediaStarted) {
  if (!this._initializeMediaStream(rtcConstraints, iceServers)) {
    return;
  }

  var self = this;
  this.callSid = callsid;
  function onAnswerSuccess() {
    onMediaStarted(self.version.pc);
  }
  function onAnswerError(err) {
    var errMsg = err.message || err;
    self.onerror({ info: { code: 31000, message: 'Error processing answer: ' + errMsg } });
  }
  this._onAnswerOrRinging = function (payload) {
    if (!payload.sdp) {
      return;
    }

    self._answerSdp = payload.sdp;
    if (self.status !== 'closed') {
      self.version.processAnswer(payload.sdp, onAnswerSuccess, onAnswerError);
    }
    self.pstream.removeListener('answer', self._onAnswerOrRinging);
    self.pstream.removeListener('ringing', self._onAnswerOrRinging);
  };
  this.pstream.on('answer', this._onAnswerOrRinging);
  this.pstream.on('ringing', this._onAnswerOrRinging);

  function onOfferSuccess() {
    if (self.status !== 'closed') {
      self.pstream.publish('invite', {
        sdp: self.version.getSDP(),
        callsid: self.callSid,
        twilio: params ? { params: params } : {}
      });
    }
  }

  function onOfferError(err) {
    var errMsg = err.message || err;
    self.onerror({ info: { code: 31000, message: 'Error creating the offer: ' + errMsg } });
  }

  this.version.createOffer({ audio: true }, onOfferSuccess, onOfferError);
};
PeerConnection.prototype.answerIncomingCall = function (callSid, sdp, rtcConstraints, iceServers, onMediaStarted) {
  if (!this._initializeMediaStream(rtcConstraints, iceServers)) {
    return;
  }
  this._answerSdp = sdp.replace(/^a=setup:actpass$/gm, 'a=setup:passive');
  this.callSid = callSid;
  var self = this;
  function onAnswerSuccess() {
    if (self.status !== 'closed') {
      self.pstream.publish('answer', {
        callsid: callSid,
        sdp: self.version.getSDP()
      });
      onMediaStarted(self.version.pc);
    }
  }
  function onAnswerError(err) {
    var errMsg = err.message || err;
    self.onerror({ info: { code: 31000, message: 'Error creating the answer: ' + errMsg } });
  }
  this.version.processSDP(sdp, { audio: true }, onAnswerSuccess, onAnswerError);
};
PeerConnection.prototype.close = function () {
  if (this.version && this.version.pc) {
    if (this.version.pc.signalingState !== 'closed') {
      this.version.pc.close();
    }

    this.version.pc = null;
  }
  if (this.stream) {
    this.mute(false);
    this._stopStream(this.stream);
  }
  this.stream = null;
  if (this.pstream) {
    this.pstream.removeListener('answer', this._onAnswerOrRinging);
  }
  this._removeAudioOutputs();
  if (this._mediaStreamSource) {
    this._mediaStreamSource.disconnect();
  }
  if (this._inputAnalyser) {
    this._inputAnalyser.disconnect();
  }
  if (this._outputAnalyser) {
    this._outputAnalyser.disconnect();
  }
  this.status = 'closed';
  this.onclose();
};
PeerConnection.prototype.reject = function (callSid) {
  this.callSid = callSid;
};
PeerConnection.prototype.ignore = function (callSid) {
  this.callSid = callSid;
};
/**
 * Mute or unmute input audio. If the stream is not yet present, the setting
 *   is saved and applied to future streams/tracks.
 * @params {boolean} shouldMute - Whether the input audio should
 *   be muted or unmuted.
 */
PeerConnection.prototype.mute = function (shouldMute) {
  this.isMuted = shouldMute;
  if (!this.stream) {
    return;
  }

  var audioTracks = typeof this.stream.getAudioTracks === 'function' ? this.stream.getAudioTracks() : this.stream.audioTracks;

  audioTracks.forEach(function (track) {
    track.enabled = !shouldMute;
  });
};
/**
 * Get or create an RTCDTMFSender for the first local audio MediaStreamTrack
 * we can get from the RTCPeerConnection. Return null if unsupported.
 * @instance
 * @returns ?RTCDTMFSender
 */
PeerConnection.prototype.getOrCreateDTMFSender = function getOrCreateDTMFSender() {
  if (this._dtmfSender || this._dtmfSenderUnsupported) {
    return this._dtmfSender || null;
  }

  var self = this;
  var pc = this.version.pc;
  if (!pc) {
    this.log('No RTCPeerConnection available to call createDTMFSender on');
    return null;
  }

  if (typeof pc.getSenders === 'function' && (typeof RTCDTMFSender === 'function' || typeof RTCDtmfSender === 'function')) {
    var sender = pc.getSenders().find(function (sender) {
      return sender.dtmf;
    });
    if (sender && sender.dtmf) {
      this.log('Using RTCRtpSender#dtmf');
      this._dtmfSender = sender.dtmf;
      return this._dtmfSender;
    }
  }

  if (typeof pc.createDTMFSender === 'function' && typeof pc.getLocalStreams === 'function') {
    var track = pc.getLocalStreams().map(function (stream) {
      var tracks = self._getAudioTracks(stream);
      return tracks && tracks[0];
    })[0];

    if (!track) {
      this.log('No local audio MediaStreamTrack available on the RTCPeerConnection to pass to createDTMFSender');
      return null;
    }

    this.log('Creating RTCDTMFSender');
    this._dtmfSender = pc.createDTMFSender(track);
    return this._dtmfSender;
  }

  this.log('RTCPeerConnection does not support RTCDTMFSender');
  this._dtmfSenderUnsupported = true;
  return null;
};

PeerConnection.prototype._canStopMediaStreamTrack = function () {
  return typeof MediaStreamTrack.prototype.stop === 'function';
};

PeerConnection.prototype._getAudioTracks = function (stream) {
  return typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : stream.audioTracks;
};

PeerConnection.prototype._getProtocol = function () {
  return PeerConnection.protocol;
};

PeerConnection.protocol = function () {
  return RTCPC.test() ? new RTCPC() : null;
}();

function addStream(pc, stream) {
  if (typeof pc.addTrack === 'function') {
    stream.getAudioTracks().forEach(function (track) {
      // The second parameters, stream, should not be necessary per the latest editor's
      //   draft, but FF requires it. https://bugzilla.mozilla.org/show_bug.cgi?id=1231414
      pc.addTrack(track, stream);
    });
  } else {
    pc.addStream(stream);
  }
}

function cloneStream(oldStream) {
  var newStream = typeof MediaStream !== 'undefined' ? new MediaStream()
  // eslint-disable-next-line
  : new webkitMediaStream();

  oldStream.getAudioTracks().forEach(newStream.addTrack, newStream);
  return newStream;
}

function removeStream(pc, stream) {
  if (typeof pc.removeTrack === 'function') {
    pc.getSenders().forEach(function (sender) {
      pc.removeTrack(sender);
    });
  } else {
    pc.removeStream(stream);
  }
}

/**
 * Set the source of an HTMLAudioElement to the specified MediaStream
 * @param {HTMLAudioElement} audio
 * @param {MediaStream} stream
 * @returns {boolean} Whether the audio source was set successfully
 */
function setAudioSource(audio, stream) {
  if (typeof audio.srcObject !== 'undefined') {
    audio.srcObject = stream;
  } else if (typeof audio.mozSrcObject !== 'undefined') {
    audio.mozSrcObject = stream;
  } else if (typeof audio.src !== 'undefined') {
    var _window = audio.options.window || window;
    audio.src = (_window.URL || _window.webkitURL).createObjectURL(stream);
  } else {
    return false;
  }

  return true;
}

PeerConnection.enabled = !!PeerConnection.protocol;

module.exports = PeerConnection;
},{"../log":9,"../statemachine":26,"../util":28,"./rtcpc":20}],20:[function(require,module,exports){
(function (global){
/* global webkitRTCPeerConnection, mozRTCPeerConnection, mozRTCSessionDescription, mozRTCIceCandidate */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var RTCPeerConnectionShim = require('rtcpeerconnection-shim');
var util = require('../util');

function RTCPC() {
  if (typeof window === 'undefined') {
    this.log('No RTCPeerConnection implementation available. The window object was not found.');
    return;
  }

  if (util.isEdge()) {
    this.RTCPeerConnection = new RTCPeerConnectionShim(typeof window !== 'undefined' ? window : global);
  } else if (typeof window.RTCPeerConnection === 'function') {
    this.RTCPeerConnection = window.RTCPeerConnection;
  } else if (typeof window.webkitRTCPeerConnection === 'function') {
    this.RTCPeerConnection = webkitRTCPeerConnection;
  } else if (typeof window.mozRTCPeerConnection === 'function') {
    this.RTCPeerConnection = mozRTCPeerConnection;
    window.RTCSessionDescription = mozRTCSessionDescription;
    window.RTCIceCandidate = mozRTCIceCandidate;
  } else {
    this.log('No RTCPeerConnection implementation available');
  }
}

RTCPC.prototype.create = function (log, rtcConstraints, iceServers) {
  this.log = log;
  this.pc = new this.RTCPeerConnection({ iceServers: iceServers }, rtcConstraints);
};
RTCPC.prototype.createModernConstraints = function (c) {
  // createOffer differs between Chrome 23 and Chrome 24+.
  // See https://groups.google.com/forum/?fromgroups=#!topic/discuss-webrtc/JBDZtrMumyU
  // Unfortunately I haven't figured out a way to detect which format
  // is required ahead of time, so we'll first try the old way, and
  // if we get an exception, then we'll try the new way.
  if (typeof c === 'undefined') {
    return null;
  }
  // NOTE(mroberts): As of Chrome 38, Chrome still appears to expect
  // constraints under the 'mandatory' key, and with the first letter of each
  // constraint capitalized. Firefox, on the other hand, has deprecated the
  // 'mandatory' key and does not expect the first letter of each constraint
  // capitalized.
  var nc = {};
  if (typeof webkitRTCPeerConnection !== 'undefined' && !util.isEdge()) {
    nc.mandatory = {};
    if (typeof c.audio !== 'undefined') {
      nc.mandatory.OfferToReceiveAudio = c.audio;
    }
    if (typeof c.video !== 'undefined') {
      nc.mandatory.OfferToReceiveVideo = c.video;
    }
  } else {
    if (typeof c.audio !== 'undefined') {
      nc.offerToReceiveAudio = c.audio;
    }
    if (typeof c.video !== 'undefined') {
      nc.offerToReceiveVideo = c.video;
    }
  }
  return nc;
};
RTCPC.prototype.createOffer = function (constraints, onSuccess, onError) {
  var self = this;

  constraints = this.createModernConstraints(constraints);
  promisifyCreate(this.pc.createOffer, this.pc)(constraints).then(function (sd) {
    return self.pc && promisifySet(self.pc.setLocalDescription, self.pc)(new RTCSessionDescription(sd));
  }).then(onSuccess, onError);
};
RTCPC.prototype.createAnswer = function (constraints, onSuccess, onError) {
  var self = this;

  constraints = this.createModernConstraints(constraints);
  promisifyCreate(this.pc.createAnswer, this.pc)(constraints).then(function (sd) {
    return self.pc && promisifySet(self.pc.setLocalDescription, self.pc)(new RTCSessionDescription(sd));
  }).then(onSuccess, onError);
};
RTCPC.prototype.processSDP = function (sdp, constraints, onSuccess, onError) {
  var self = this;

  var desc = new RTCSessionDescription({ sdp: sdp, type: 'offer' });
  promisifySet(this.pc.setRemoteDescription, this.pc)(desc).then(function () {
    self.createAnswer(constraints, onSuccess, onError);
  });
};
RTCPC.prototype.getSDP = function () {
  return this.pc.localDescription.sdp;
};
RTCPC.prototype.processAnswer = function (sdp, onSuccess, onError) {
  if (!this.pc) {
    return;
  }

  promisifySet(this.pc.setRemoteDescription, this.pc)(new RTCSessionDescription({ sdp: sdp, type: 'answer' })).then(onSuccess, onError);
};
/* NOTE(mroberts): Firefox 18 through 21 include a `mozRTCPeerConnection`
   object, but attempting to instantiate it will throw the error

       Error: PeerConnection not enabled (did you set the pref?)

   unless the `media.peerconnection.enabled` pref is enabled. So we need to test
   if we can actually instantiate `mozRTCPeerConnection`; however, if the user
   *has* enabled `media.peerconnection.enabled`, we need to perform the same
   test that we use to detect Firefox 24 and above, namely:

       typeof (new mozRTCPeerConnection()).getLocalStreams === 'function'

*/
RTCPC.test = function () {
  if ((typeof navigator === 'undefined' ? 'undefined' : _typeof(navigator)) === 'object') {
    var getUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia;

    if (getUserMedia && typeof window.RTCPeerConnection === 'function') {
      return true;
    } else if (getUserMedia && typeof window.webkitRTCPeerConnection === 'function') {
      return true;
    } else if (getUserMedia && typeof window.mozRTCPeerConnection === 'function') {
      try {
        // eslint-disable-next-line new-cap
        var test = new window.mozRTCPeerConnection();
        if (typeof test.getLocalStreams !== 'function') return false;
      } catch (e) {
        return false;
      }
      return true;
      // FIXME(mroberts): Use better criteria for identifying Edge/ORTC.
    } else if (typeof RTCIceGatherer !== 'undefined') {
      return true;
    }
  }

  return false;
};

function promisify(fn, ctx, areCallbacksFirst) {
  return function () {
    var args = Array.prototype.slice.call(arguments);

    return new Promise(function (resolve) {
      resolve(fn.apply(ctx, args));
    }).catch(function () {
      return new Promise(function (resolve, reject) {
        fn.apply(ctx, areCallbacksFirst ? [resolve, reject].concat(args) : args.concat([resolve, reject]));
      });
    });
  };
}

function promisifyCreate(fn, ctx) {
  return promisify(fn, ctx, true);
}

function promisifySet(fn, ctx) {
  return promisify(fn, ctx, false);
}

module.exports = RTCPC;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../util":28,"rtcpeerconnection-shim":42}],21:[function(require,module,exports){
/* eslint-disable no-fallthrough */
'use strict';

var MockRTCStatsReport = require('./mockrtcstatsreport');

var ERROR_PEER_CONNECTION_NULL = 'PeerConnection is null';
var ERROR_WEB_RTC_UNSUPPORTED = 'WebRTC statistics are unsupported';
var SIGNED_SHORT = 32767;

// (rrowland) Only needed to detect Chrome so we can force using legacy stats until standard
// stats are fixed in Chrome.
var isChrome = false;
if (typeof window !== 'undefined') {
  var isCriOS = !!window.navigator.userAgent.match('CriOS');
  var isElectron = !!window.navigator.userAgent.match('Electron');
  var isGoogle = typeof window.chrome !== 'undefined' && window.navigator.vendor === 'Google Inc.' && window.navigator.userAgent.indexOf('OPR') === -1 && window.navigator.userAgent.indexOf('Edge') === -1;

  isChrome = isCriOS || isElectron || isGoogle;
}

/**
 * @typedef {Object} StatsOptions
 * Used for testing to inject and extract methods.
 * @property {function} [createRTCSample] - Method for parsing an RTCStatsReport
 */
/**
 * Collects any WebRTC statistics for the given {@link PeerConnection}
 * @param {PeerConnection} peerConnection - Target connection.
 * @param {StatsOptions} options - List of custom options.
 * @return {Promise<RTCSample>} Universally-formatted version of RTC stats.
 */
function getStatistics(peerConnection, options) {
  options = Object.assign({
    createRTCSample: createRTCSample
  }, options);

  if (!peerConnection) {
    return Promise.reject(new Error(ERROR_PEER_CONNECTION_NULL));
  }

  if (typeof peerConnection.getStats !== 'function') {
    return Promise.reject(new Error(ERROR_WEB_RTC_UNSUPPORTED));
  }

  // (rrowland) Force using legacy stats on Chrome until audioLevel of the outbound
  // audio track is no longer constantly zero.
  if (isChrome) {
    return new Promise(function (resolve, reject) {
      return peerConnection.getStats(resolve, reject);
    }).then(MockRTCStatsReport.fromRTCStatsResponse).then(options.createRTCSample);
  }

  var promise;
  try {
    promise = peerConnection.getStats();
  } catch (e) {
    promise = new Promise(function (resolve, reject) {
      return peerConnection.getStats(resolve, reject);
    }).then(MockRTCStatsReport.fromRTCStatsResponse);
  }

  return promise.then(options.createRTCSample);
}

/**
 * @typedef {Object} RTCSample - A sample containing relevant WebRTC stats information.
 * @property {Number} [timestamp]
 * @property {String} [codecName] - MimeType name of the codec being used by the outbound audio stream
 * @property {Number} [rtt] - Round trip time
 * @property {Number} [jitter]
 * @property {Number} [packetsSent]
 * @property {Number} [packetsLost]
 * @property {Number} [packetsReceived]
 * @property {Number} [bytesReceived]
 * @property {Number} [bytesSent]
 * @property {Number} [localAddress]
 * @property {Number} [remoteAddress]
 * @property {Number} [audioInputLevel] - Between 0 and 32767
 * @property {Number} [audioOutputLevel] - Between 0 and 32767
 */
function RTCSample() {}

/**
 * Create an RTCSample object from an RTCStatsReport
 * @private
 * @param {RTCStatsReport} statsReport
 * @returns {RTCSample}
 */
function createRTCSample(statsReport) {
  var activeTransportId = null;
  var sample = new RTCSample();
  var fallbackTimestamp;

  Array.from(statsReport.values()).forEach(function (stats) {
    // Firefox hack -- Firefox doesn't have dashes in type names
    var type = stats.type.replace('-', '');

    fallbackTimestamp = fallbackTimestamp || stats.timestamp;

    switch (type) {
      case 'inboundrtp':
        sample.timestamp = sample.timestamp || stats.timestamp;
        sample.jitter = stats.jitter * 1000;
        sample.packetsLost = stats.packetsLost;
        sample.packetsReceived = stats.packetsReceived;
        sample.bytesReceived = stats.bytesReceived;

        var inboundTrack = statsReport.get(stats.trackId);
        if (inboundTrack) {
          sample.audioOutputLevel = inboundTrack.audioLevel * SIGNED_SHORT;
        }
        break;
      case 'outboundrtp':
        sample.timestamp = stats.timestamp;
        sample.packetsSent = stats.packetsSent;
        sample.bytesSent = stats.bytesSent;

        if (stats.codecId && statsReport.get(stats.codecId)) {
          var mimeType = statsReport.get(stats.codecId).mimeType;
          sample.codecName = mimeType && mimeType.match(/(.*\/)?(.*)/)[2];
        }

        var outboundTrack = statsReport.get(stats.trackId);
        if (outboundTrack) {
          sample.audioInputLevel = outboundTrack.audioLevel * SIGNED_SHORT;
        }
        break;
      case 'transport':
        if (stats.dtlsState === 'connected') {
          activeTransportId = stats.id;
        }
        break;
    }
  });

  if (!sample.timestamp) {
    sample.timestamp = fallbackTimestamp;
  }

  var activeTransport = statsReport.get(activeTransportId);
  if (!activeTransport) {
    return sample;
  }

  var selectedCandidatePair = statsReport.get(activeTransport.selectedCandidatePairId);
  if (!selectedCandidatePair) {
    return sample;
  }

  var localCandidate = statsReport.get(selectedCandidatePair.localCandidateId);
  var remoteCandidate = statsReport.get(selectedCandidatePair.remoteCandidateId);

  Object.assign(sample, {
    localAddress: localCandidate && localCandidate.ip,
    remoteAddress: remoteCandidate && remoteCandidate.ip,
    rtt: selectedCandidatePair && selectedCandidatePair.currentRoundTripTime * 1000
  });

  return sample;
}

module.exports = getStatistics;
},{"./mockrtcstatsreport":16}],22:[function(require,module,exports){
'use strict';

var EventEmitter = require('events').EventEmitter;

function EventTarget() {
  Object.defineProperties(this, {
    _eventEmitter: {
      value: new EventEmitter()
    },
    _handlers: {
      value: {}
    }
  });
}

EventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
  return this._eventEmitter.emit(event.type, event);
};

EventTarget.prototype.addEventListener = function addEventListener() {
  return this._eventEmitter.addListener.apply(this._eventEmitter, arguments);
};

EventTarget.prototype.removeEventListener = function removeEventListener() {
  return this._eventEmitter.removeListener.apply(this._eventEmitter, arguments);
};

EventTarget.prototype._defineEventHandler = function _defineEventHandler(eventName) {
  var self = this;
  Object.defineProperty(this, 'on' + eventName, {
    get: function get() {
      return self._handlers[eventName];
    },
    set: function set(newHandler) {
      var oldHandler = self._handlers[eventName];

      if (oldHandler && (typeof newHandler === 'function' || typeof newHandler === 'undefined' || newHandler === null)) {
        self._handlers[eventName] = null;
        self.removeEventListener(eventName, oldHandler);
      }

      if (typeof newHandler === 'function') {
        self._handlers[eventName] = newHandler;
        self.addEventListener(eventName, newHandler);
      }
    }
  });
};

module.exports = EventTarget;
},{"events":37}],23:[function(require,module,exports){
'use strict';

function MediaDeviceInfoShim(options) {
  Object.defineProperties(this, {
    deviceId: { get: function get() {
        return options.deviceId;
      } },
    groupId: { get: function get() {
        return options.groupId;
      } },
    kind: { get: function get() {
        return options.kind;
      } },
    label: { get: function get() {
        return options.label;
      } }
  });
}

module.exports = MediaDeviceInfoShim;
},{}],24:[function(require,module,exports){
'use strict';

var EventTarget = require('./eventtarget');
var inherits = require('util').inherits;

var POLL_INTERVAL_MS = 500;

var nativeMediaDevices = typeof navigator !== 'undefined' && navigator.mediaDevices;

/**
 * Make a custom MediaDevices object, and proxy through existing functionality. If
 *   devicechange is present, we simply reemit the event. If not, we will do the
 *   detection ourselves and fire the event when necessary. The same logic exists
 *   for deviceinfochange for consistency, however deviceinfochange is our own event
 *   so it is unlikely that it will ever be native. The w3c spec for devicechange
 *   is unclear as to whether MediaDeviceInfo changes (such as label) will
 *   trigger the devicechange event. We have an open question on this here:
 *   https://bugs.chromium.org/p/chromium/issues/detail?id=585096
 */
function MediaDevicesShim() {
  EventTarget.call(this);

  this._defineEventHandler('devicechange');
  this._defineEventHandler('deviceinfochange');

  var knownDevices = [];
  Object.defineProperties(this, {
    _deviceChangeIsNative: {
      value: reemitNativeEvent(this, 'devicechange')
    },
    _deviceInfoChangeIsNative: {
      value: reemitNativeEvent(this, 'deviceinfochange')
    },
    _knownDevices: {
      value: knownDevices
    },
    _pollInterval: {
      value: null,
      writable: true
    }
  });

  if (typeof nativeMediaDevices.enumerateDevices === 'function') {
    nativeMediaDevices.enumerateDevices().then(function (devices) {
      devices.sort(sortDevicesById).forEach([].push, knownDevices);
    });
  }

  this._eventEmitter.on('newListener', function maybeStartPolling(eventName) {
    if (eventName !== 'devicechange' && eventName !== 'deviceinfochange') {
      return;
    }

    this._pollInterval = this._pollInterval || setInterval(sampleDevices.bind(null, this), POLL_INTERVAL_MS);
  }.bind(this));

  this._eventEmitter.on('removeListener', function maybeStopPolling() {
    if (this._pollInterval && !hasChangeListeners(this)) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }.bind(this));
}

inherits(MediaDevicesShim, EventTarget);

if (nativeMediaDevices && typeof nativeMediaDevices.enumerateDevices === 'function') {
  MediaDevicesShim.prototype.enumerateDevices = function enumerateDevices() {
    return nativeMediaDevices.enumerateDevices.apply(nativeMediaDevices, arguments);
  };
}

MediaDevicesShim.prototype.getUserMedia = function getUserMedia() {
  return nativeMediaDevices.getUserMedia.apply(nativeMediaDevices, arguments);
};

function deviceInfosHaveChanged(newDevices, oldDevices) {
  var oldLabels = oldDevices.reduce(function (map, device) {
    return map.set(device.deviceId, device.label || null);
  }, new Map());

  return newDevices.some(function (newDevice) {
    var oldLabel = oldLabels.get(newDevice.deviceId);
    return typeof oldLabel !== 'undefined' && oldLabel !== newDevice.label;
  });
}

function devicesHaveChanged(newDevices, oldDevices) {
  return newDevices.length !== oldDevices.length || propertyHasChanged('deviceId', newDevices, oldDevices);
}

function hasChangeListeners(mediaDevices) {
  return ['devicechange', 'deviceinfochange'].reduce(function (count, event) {
    return count + mediaDevices._eventEmitter.listenerCount(event);
  }, 0) > 0;
}

/**
 * Sample the current set of devices and emit devicechange event if a device has been
 *   added or removed, and deviceinfochange if a device's label has changed.
 * @param {MediaDevicesShim} mediaDevices
 * @private
 */
function sampleDevices(mediaDevices) {
  nativeMediaDevices.enumerateDevices().then(function (newDevices) {
    var knownDevices = mediaDevices._knownDevices;
    var oldDevices = knownDevices.slice();

    // Replace known devices in-place
    [].splice.apply(knownDevices, [0, knownDevices.length].concat(newDevices.sort(sortDevicesById)));

    if (!mediaDevices._deviceChangeIsNative && devicesHaveChanged(knownDevices, oldDevices)) {
      mediaDevices.dispatchEvent(new Event('devicechange'));
    }

    if (!mediaDevices._deviceInfoChangeIsNative && deviceInfosHaveChanged(knownDevices, oldDevices)) {
      mediaDevices.dispatchEvent(new Event('deviceinfochange'));
    }
  });
}

/**
 * Accepts two sorted arrays and the name of a property to compare on objects from each.
 *   Arrays should also be of the same length.
 * @param {string} propertyName - Name of the property to compare on each object
 * @param {Array<Object>} as - The left-side array of objects to compare.
 * @param {Array<Object>} bs - The right-side array of objects to compare.
 * @private
 * @returns {boolean} True if the property of any object in array A is different than
 *   the same property of its corresponding object in array B.
 */
function propertyHasChanged(propertyName, as, bs) {
  return as.some(function (a, i) {
    return a[propertyName] !== bs[i][propertyName];
  });
}

/**
 * Re-emit the native event, if the native mediaDevices has the corresponding property.
 * @param {MediaDevicesShim} mediaDevices
 * @param {string} eventName - Name of the event
 * @private
 * @returns {boolean} Whether the native mediaDevice had the corresponding property
 */
function reemitNativeEvent(mediaDevices, eventName) {
  var methodName = 'on' + eventName;

  function dispatchEvent(event) {
    mediaDevices.dispatchEvent(event);
  }

  if (methodName in nativeMediaDevices) {
    // Use addEventListener if it's available so we don't stomp on any other listeners
    // for this event. Currently, navigator.mediaDevices.addEventListener does not exist in Safari.
    if ('addEventListener' in nativeMediaDevices) {
      nativeMediaDevices.addEventListener(eventName, dispatchEvent);
    } else {
      nativeMediaDevices[methodName] = dispatchEvent;
    }

    return true;
  }

  return false;
}

function sortDevicesById(a, b) {
  return a.deviceId < b.deviceId;
}

module.exports = function shimMediaDevices() {
  return nativeMediaDevices ? new MediaDevicesShim() : null;
}();
},{"./eventtarget":22,"util":46}],25:[function(require,module,exports){
'use strict';

var AudioPlayer = require('AudioPlayer');

/**
 * @class
 * @param {string} name - Name of the sound
 * @param {string} url - URL of the sound
 * @param {Sound#ConstructorOptions} options
 * @property {boolean} isPlaying - Whether the Sound is currently playing audio.
 * @property {string} name - Name of the sound
 * @property {string} url - URL of the sound
 * @property {AudioContext} audioContext - The AudioContext to use if available for AudioPlayer.
 */ /**
    * @typedef {Object} Sound#ConstructorOptions
    * @property {number} [maxDuration=0] - The maximum length of time to play the sound
    *   before stopping it.
    * @property {Boolean} [shouldLoop=false] - Whether the sound should be looped.
    */
function Sound(name, url, options) {
  if (!(this instanceof Sound)) {
    return new Sound(name, url, options);
  }

  if (!name || !url) {
    throw new Error('name and url are required arguments');
  }

  options = Object.assign({
    AudioFactory: typeof Audio !== 'undefined' ? Audio : null,
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
      value: options.AudioFactory !== null && typeof options.AudioFactory.prototype.setSinkId === 'function'
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
      value: ['default']
    },
    isPlaying: {
      enumerable: true,
      get: function get() {
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
  el.preload = 'auto';
  el.muted = true;

  // Play it (muted) as soon as possible so that it does not get incorrectly caught by Chrome's
  // "gesture requirement for media playback" feature.
  // https://plus.google.com/+FrancoisBeaufort/posts/6PiJQqJzGqX
  el.play();
}

/**
 * Update the sinkIds of the audio output devices this sound should play through.
 */
Sound.prototype.setSinkIds = function setSinkIds(ids) {
  if (!this._isSinkSupported) {
    return;
  }

  ids = ids.forEach ? ids : [ids];
  [].splice.apply(this._sinkIds, [0, this._sinkIds.length].concat(ids));
};

/**
 * Stop playing the sound.
 * @return {void}
 */
Sound.prototype.stop = function stop() {
  this._activeEls.forEach(function (audioEl) {
    audioEl.pause();
    audioEl.src = '';
    audioEl.load();
  });

  this._activeEls.clear();

  clearTimeout(this._maxDurationTimeout);

  this._playPromise = null;
  this._maxDurationTimeout = null;
};

/**
 * Start playing the sound. Will stop the currently playing sound first.
 */
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

    audioElement.addEventListener('ended', function () {
      self._activeEls.delete(audioElement);
    });

    /**
     * (rrowland) Bug in Chrome 53 & 54 prevents us from calling Audio.setSinkId without
     *   crashing the tab. https://bugs.chromium.org/p/chromium/issues/detail?id=655342
     */
    return new Promise(function (resolve) {
      audioElement.addEventListener('canplaythrough', resolve);
    }).then(function () {
      // If stop has already been called, or another play has been initiated,
      // bail out before setting up the element to play.
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
},{"AudioPlayer":33}],26:[function(require,module,exports){
'use strict';

var inherits = require('util').inherits;

/**
 * Construct a {@link StateMachine}.
 * @class
 * @classdesc A {@link StateMachine} is defined by an object whose keys are
 *   state names and whose values are arrays of valid states to transition to.
 *   All state transitions, valid or invalid, are recorded.
 * @param {?string} initialState
 * @param {object} states
 * @property {string} currentState
 * @proeprty {object} states
 * @property {Array<StateTransition>} transitions
 */
function StateMachine(states, initialState) {
  if (!(this instanceof StateMachine)) {
    return new StateMachine(states, initialState);
  }
  var currentState = initialState;
  Object.defineProperties(this, {
    _currentState: {
      get: function get() {
        return currentState;
      },
      set: function set(_currentState) {
        currentState = _currentState;
      }
    },
    currentState: {
      enumerable: true,
      get: function get() {
        return currentState;
      }
    },
    states: {
      enumerable: true,
      value: states
    },
    transitions: {
      enumerable: true,
      value: []
    }
  });
  Object.freeze(this);
}

/**
 * Transition the {@link StateMachine}, recording either a valid or invalid
 * transition. If the transition was valid, we complete the transition before
 * throwing the {@link InvalidStateTransition}.
 * @param {string} to
 * @throws {InvalidStateTransition}
 * @returns {this}
 */
StateMachine.prototype.transition = function transition(to) {
  var from = this.currentState;
  var valid = this.states[from];
  var newTransition = valid && valid.indexOf(to) !== -1 ? new StateTransition(from, to) : new InvalidStateTransition(from, to);
  this.transitions.push(newTransition);
  this._currentState = to;
  if (newTransition instanceof InvalidStateTransition) {
    throw newTransition;
  }
  return this;
};

/**
 * Construct a {@link StateTransition}.
 * @class
 * @param {?string} from
 * @param {string} to
 * @property {?string} from
 * @property {string} to
 */
function StateTransition(from, to) {
  Object.defineProperties(this, {
    from: {
      enumerable: true,
      value: from
    },
    to: {
      enumerable: true,
      value: to
    }
  });
}

/**
 * Construct an {@link InvalidStateTransition}.
 * @class
 * @augments Error
 * @augments StateTransition
 * @param {?string} from
 * @param {string} to
 * @property {?string} from
 * @property {string} to
 * @property {string} message
 */
function InvalidStateTransition(from, to) {
  if (!(this instanceof InvalidStateTransition)) {
    return new InvalidStateTransition(from, to);
  }
  Error.call(this);
  StateTransition.call(this, from, to);
  var errorMessage = 'Invalid transition from ' + (typeof from === 'string' ? '"' + from + '"' : 'null') + ' to "' + to + '"';
  Object.defineProperties(this, {
    message: {
      enumerable: true,
      value: errorMessage
    }
  });
  Object.freeze(this);
}

inherits(InvalidStateTransition, Error);

module.exports = StateMachine;
},{"util":46}],27:[function(require,module,exports){
'use strict';

exports.SOUNDS_DEPRECATION_WARNING = 'Device.sounds is deprecated and will be removed in the next breaking ' + 'release. Please use the new functionality available on Device.audio.';

/**
 * Create an EventEmitter warning.
 * @param {string} event - event name
 * @param {string} name - EventEmitter name
 * @param {number} maxListeners - the maximum number of event listeners recommended
 * @returns {string} warning
 */
function generateEventWarning(event, name, maxListeners) {
  return 'The number of ' + event + ' listeners on ' + name + ' ' + 'exceeds the recommended number of ' + maxListeners + '. ' + 'While twilio.js will continue to function normally, this ' + 'may be indicative of an application error. Note that ' + event + ' listeners exist for the lifetime of the ' + name + '.';
}

exports.generateEventWarning = generateEventWarning;
},{}],28:[function(require,module,exports){
(function (global,Buffer){
/* global Set, base64 */
/* eslint-disable no-process-env */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var EventEmitter = require('events').EventEmitter;
var generateEventWarning = require('./strings').generateEventWarning;
var pkg = require('../../package.json');

function getReleaseVersion() {
  return pkg.version;
}

function getSoundVersion() {
  return '1.0.0';
}

function getTwilioRoot() {
  return 'https://media.twiliocdn.com/sdk/js/client/';
}

/**
 * Exception class.
 * @class
 * @name Exception
 * @exports Exception as Twilio.Exception
 * @memberOf Twilio
 * @param {string} message The exception message
 */
function TwilioException(message) {
  if (!(this instanceof TwilioException)) {
    return new TwilioException(message);
  }
  this.message = message;
}

/**
 * Returns the exception message.
 *
 * @return {string} The exception message.
 */
TwilioException.prototype.toString = function () {
  return 'Twilio.Exception: ' + this.message;
};

function memoize(fn) {
  return function () {
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
    encodedPayload += new Array(padlen + 1).join('=');
  }
  encodedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
  var decodedPayload = _atob(encodedPayload);
  return JSON.parse(decodedPayload);
}

var memoizedDecodePayload = memoize(decodePayload);

/**
 * Decodes a token.
 *
 * @name decode
 * @exports decode as Twilio.decode
 * @memberOf Twilio
 * @function
 * @param {string} token The JWT
 * @return {object} The payload
 */
function decode(token) {
  var segs = token.split('.');
  if (segs.length !== 3) {
    throw new TwilioException('Wrong number of segments');
  }
  var encodedPayload = segs[1];
  var payload = memoizedDecodePayload(encodedPayload);
  return payload;
}

function makedict(params) {
  if (params === '') return {};
  if (params.indexOf('&') === -1 && params.indexOf('=') === -1) return params;
  var pairs = params.split('&');
  var result = {};
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].split('=');
    result[decodeURIComponent(pair[0])] = makedict(decodeURIComponent(pair[1]));
  }
  return result;
}

function makescope(uri) {
  var parts = uri.match(/^scope:(\w+):(\w+)\??(.*)$/);
  if (!(parts && parts.length === 4)) {
    throw new TwilioException('Bad scope URI');
  }
  return {
    service: parts[1],
    privilege: parts[2],
    params: makedict(parts[3])
  };
}

/**
 * Encodes a Javascript object into a query string.
 * Based on python's urllib.urlencode.
 * @name urlencode
 * @memberOf Twilio
 * @function
 * @param {object} paramsDict The key-value store of params
 * @param {bool} doseq If True, look for values as lists for multival params
 */
function urlencode(paramsDict, doseq) {
  var parts = [];
  var value;
  doseq = doseq || false;
  for (var key in paramsDict) {
    if (doseq && paramsDict[key] instanceof Array) {
      for (var index in paramsDict[key]) {
        value = paramsDict[key][index];
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      }
    } else {
      value = paramsDict[key];
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
  }
  return parts.join('&');
}

function objectize(token) {
  var jwt = decode(token);
  var scopes = jwt.scope.length === 0 ? [] : jwt.scope.split(' ');
  var newscopes = {};
  for (var i = 0; i < scopes.length; i++) {
    var scope = makescope(scopes[i]);
    newscopes[scope.service + ':' + scope.privilege] = scope;
  }
  jwt.scope = newscopes;
  return jwt;
}

var memoizedObjectize = memoize(objectize);

/**
 * Wrapper for btoa.
 *
 * @name btoa
 * @exports _btoa as Twilio.btoa
 * @memberOf Twilio
 * @function
 * @param {string} message The decoded string
 * @return {string} The encoded string
 */
function _btoa(message) {
  try {
    return btoa(message);
  } catch (e) {
    return new Buffer(message).toString('base64');
  }
}

/**
 * Wrapper for atob.
 *
 * @name atob
 * @exports _atob as Twilio.atob
 * @memberOf Twilio
 * @function
 * @param {string} encoded The encoded string
 * @return {string} The decoded string
 */
function _atob(encoded) {
  try {
    return atob(encoded);
  } catch (e) {
    try {
      return new Buffer(encoded, 'base64').toString('ascii');
    } catch (e2) {
      return base64.decode(encoded);
    }
  }
}

/**
 * Generates JWT tokens. For simplicity, only the payload segment is viable;
 * the header and signature are garbage.
 *
 * @param object payload The payload
 * @return string The JWT
 */
function dummyToken(payload) {
  var tokenDefaults = {
    iss: 'AC1111111111111111111111111111111',
    exp: 1400000000
  };
  for (var k in tokenDefaults) {
    payload[k] = payload[k] || tokenDefaults[k];
  }
  var encodedPayload = _btoa(JSON.stringify(payload));
  encodedPayload = encodedPayload.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return ['*', encodedPayload, '*'].join('.');
}

function bind(fn, ctx) {
  var applied = Array.prototype.slice.call(arguments, 2);
  return function () {
    var extra = Array.prototype.slice.call(arguments);
    return fn.apply(ctx, applied.concat(extra));
  };
}

function getSystemInfo() {
  var nav = typeof navigator !== 'undefined' ? navigator : {};

  var info = {
    p: 'browser',
    v: getReleaseVersion(),
    browser: {
      userAgent: nav.userAgent || 'unknown',
      platform: nav.platform || 'unknown'
    },
    plugin: 'rtc'
  };

  return info;
}

function trim(str) {
  if (typeof str !== 'string') return '';
  return str.trim ? str.trim() : str.replace(/^\s+|\s+$/g, '');
}

/**
 * Splits a concatenation of multiple JSON strings into a list of JSON strings.
 *
 * @param string json The string of multiple JSON strings
 * @param boolean validate If true, thrown an error on invalid syntax
 *
 * @return array A list of JSON strings
 */
function splitObjects(json) {
  var trimmed = trim(json);
  return trimmed.length === 0 ? [] : trimmed.split('\n');
}

function generateConnectionUUID() {
  return 'TJSxxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : r & 0x3 | 0x8;
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
      /* eslint-disable no-console */
      if (typeof console !== 'undefined') {
        if (console.warn) {
          console.warn(warning);
        } else if (console.log) {
          console.log(warning);
        }
      }
      /* eslint-enable no-console */
      object.removeListener('newListener', monitor);
    }
  }
  object.on('newListener', monitor);
}

// This definition of deepEqual is adapted from Node's deepEqual.
function deepEqual(a, b) {
  if (a === b) {
    return true;
  } else if ((typeof a === 'undefined' ? 'undefined' : _typeof(a)) !== (typeof b === 'undefined' ? 'undefined' : _typeof(b))) {
    return false;
  } else if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  } else if ((typeof a === 'undefined' ? 'undefined' : _typeof(a)) !== 'object' && (typeof b === 'undefined' ? 'undefined' : _typeof(b)) !== 'object') {
    return a === b;
  }

  return objectDeepEqual(a, b);
}

var objectKeys = typeof Object.keys === 'function' ? Object.keys : function (obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }
  return keys;
};

function isUndefinedOrNull(a) {
  return typeof a === 'undefined' || a === null;
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
  return values.reduce(function (t, v) {
    return t + v;
  }) / values.length;
}

function difference(lefts, rights, getKey) {
  getKey = getKey || function (a) {
    return a;
  };

  var rightKeys = new Set(rights.map(getKey));

  return lefts.filter(function (left) {
    return !rightKeys.has(getKey(left));
  });
}

function encodescope(service, privilege, params) {
  var capability = ['scope', service, privilege].join(':');
  var empty = true;
  for (var _ in params) {
    void _;empty = false;break;
  }
  return empty ? capability : capability + '?' + buildquery(params);
}

function buildquery(params) {
  var pairs = [];
  for (var name in params) {
    var value = _typeof(params[name]) === 'object' ? buildquery(params[name]) : params[name];

    pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
  }
}

function isFirefox(navigator) {
  navigator = navigator || (typeof window === 'undefined' ? global.navigator : window.navigator);

  return navigator && typeof navigator.userAgent === 'string' && /firefox|fxios/i.test(navigator.userAgent);
}

function isEdge(navigator) {
  navigator = navigator || (typeof window === 'undefined' ? global.navigator : window.navigator);

  return navigator && typeof navigator.userAgent === 'string' && /edge\/\d+/i.test(navigator.userAgent);
}

/**
 * Convert a form encoded string to a native JSON object.
 * @param {string} params - A form encoded string
 * @returns {object}
 */
function formEncodedToJson(params) {
  if (!params) {
    return {};
  }

  return params.split('&').reduce(function (output, pair) {
    var parts = pair.split('=');
    var key = decodeURIComponent(parts[0]);
    var value = decodeURIComponent(parts[1] || '');

    if (key) {
      output[key] = value;
    }
    return output;
  }, {});
}

/**
 * Convert a Map to a form encoded string. Does not build
 *   nested objects; .toString() will be called implicitly
 *   on each top-level value.
 * @param {Map} map - A Map to be stringified
 * @returns {string}
 */
function mapToFormEncoded(map) {
  if (!map) {
    return '';
  }

  return Array.from(map.entries()).map(function (parts) {
    var key = encodeURIComponent(parts[0]);
    var value = parts[1] ? encodeURIComponent(parts[1]) : '';

    return key + '=' + value;
  }).join('&');
}

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
exports.formEncodedToJson = formEncodedToJson;
exports.mapToFormEncoded = mapToFormEncoded;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"../../package.json":47,"./strings":27,"buffer":36,"events":37}],29:[function(require,module,exports){
'use strict';

var Heartbeat = require('./heartbeat').Heartbeat;
var log = require('./log');

var DefaultWebSocket = require('ws');

function noop() {}
function getTime() {
  return new Date().getTime();
}

/*
 * WebSocket transport class
 */
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
    logPrefix: '[WSTransport]',
    chunderw: 'chunderw-vpc-gll.twilio.com',
    reconnect: true,
    debug: false,
    secureSignaling: true,
    WebSocket: DefaultWebSocket
  };
  options = options || {};
  for (var prop in defaults) {
    if (prop in options) continue;
    options[prop] = defaults[prop];
  }
  self.options = options;
  self._WebSocket = options.WebSocket;

  log.mixinLog(self, self.options.logPrefix);
  self.log.enabled = self.options.debug;

  self.defaultReconnect = self.options.reconnect;

  var scheme = self.options.secureSignaling ? 'wss://' : 'ws://';
  self.uri = scheme + self.options.host + '/signal';
  return self;
}

WSTransport.prototype.msgQueue = [];
WSTransport.prototype.open = function (attempted) {
  this.log('Opening socket');
  if (this.sock && this.sock.readyState < 2) {
    this.log('Socket already open.');
    return;
  }

  this.options.reconnect = this.defaultReconnect;

  // cancel out any previous heartbeat
  if (this.heartbeat) {
    this.heartbeat.onsleep = function () {};
  }
  this.heartbeat = new Heartbeat({ interval: 15 });
  this.sock = this._connect(attempted);
};
WSTransport.prototype.send = function (msg) {
  if (this.sock) {
    if (this.sock.readyState === 0) {
      this.msgQueue.push(msg);
      return;
    }

    try {
      this.sock.send(msg);
    } catch (error) {
      this.log('Error while sending. Closing socket: ' + error.message);
      this.sock.close();
    }
  }
};
WSTransport.prototype.close = function () {
  this.log('Closing socket');
  this.options.reconnect = false;
  if (this.sock) {
    this.sock.close();
    this.sock = null;
  }
  if (this.heartbeat) {
    this.heartbeat.onsleep = function () {};
  }
};
WSTransport.prototype._cleanupSocket = function (socket) {
  if (socket) {
    this.log('Cleaning up socket');
    socket.onopen = function () {
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
WSTransport.prototype._connect = function (attempted) {
  var attempt = ++attempted || 1;

  this.log('attempting to connect');
  var sock = null;
  try {
    sock = new this._WebSocket(this.uri);
  } catch (e) {
    this.onerror({ code: 31000, message: e.message || 'Could not connect to ' + this.uri });
    this.close(); // close connection for good
    return null;
  }

  var self = this;

  // clean up old socket to avoid any race conditions with the callbacks
  var oldSocket = this.sock;
  var timeOpened = null;

  var connectTimeout = setTimeout(function () {
    self.log('connection attempt timed out');
    sock.onclose = function () {};
    sock.close();
    self.onclose();
    self._tryReconnect(attempt);
  }, 5000);

  sock.onopen = function () {
    clearTimeout(connectTimeout);
    self._cleanupSocket(oldSocket);
    timeOpened = getTime();
    self.log('Socket opened');

    // setup heartbeat onsleep and beat it once to get timer started
    self.heartbeat.onsleep = function () {
      // treat it like the socket closed because when network drops onclose does not get called right away
      self.log('Heartbeat timed out. closing socket');
      self.sock.onclose = function () {};
      self.sock.close();
      self.onclose();
      self._tryReconnect(attempt);
    };
    self.heartbeat.beat();

    self.onopen();

    // send after onopen to preserve order
    for (var i = 0; i < self.msgQueue.length; i++) {
      self.sock.send(self.msgQueue[i]);
    }
    self.msgQueue = [];
  };
  sock.onclose = function () {
    clearTimeout(connectTimeout);
    self._cleanupSocket(oldSocket);

    // clear the heartbeat onsleep callback
    self.heartbeat.onsleep = function () {};

    // reset backoff counter if connection was open for enough time to be considered successful
    if (timeOpened) {
      var socketDuration = (getTime() - timeOpened) / 1000;
      if (socketDuration > 10) {
        attempt = 1;
      }
    }

    self.log('Socket closed');
    self.onclose();
    self._tryReconnect(attempt);
  };
  sock.onerror = function (e) {
    self.log('Socket received error: ' + e.message);
    self.onerror({ code: 31000, message: e.message || 'WSTransport socket error' });
  };
  sock.onmessage = function (message) {
    self.heartbeat.beat();
    if (message.data === '\n') {
      self.send('\n');
      return;
    }

    // TODO check if error passed back from gateway is 5XX error
    // if so, retry connection with exponential backoff
    self.onmessage(message);
  };

  return sock;
};
WSTransport.prototype._tryReconnect = function (attempted) {
  attempted = attempted || 0;
  if (this.options.reconnect) {
    this.log('Attempting to reconnect.');
    var self = this;
    var backoff = 0;
    if (attempted < 5) {
      // setup exponentially random backoff
      var minBackoff = 30;
      var backoffRange = Math.pow(2, attempted) * 50;
      backoff = minBackoff + Math.round(Math.random() * backoffRange);
    } else {
      // continuous reconnect attempt
      backoff = 3000;
    }
    setTimeout(function () {
      self.open(attempted);
    }, backoff);
  }
};

exports.WSTransport = WSTransport;
},{"./heartbeat":8,"./log":9,"ws":1}],30:[function(require,module,exports){
"use strict";

var _regenerator = require("babel-runtime/regenerator");

var _regenerator2 = _interopRequireDefault(_regenerator);

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) {
            try {
                step(generator.next(value));
            } catch (e) {
                reject(e);
            }
        }
        function rejected(value) {
            try {
                step(generator["throw"](value));
            } catch (e) {
                reject(e);
            }
        }
        function step(result) {
            result.done ? resolve(result.value) : new P(function (resolve) {
                resolve(result.value);
            }).then(fulfilled, rejected);
        }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
var Deferred_1 = require("./Deferred");
var EventTarget_1 = require("./EventTarget");
/**
 * An {@link AudioPlayer} is an HTMLAudioElement-like object that uses AudioContext
 *   to circumvent browser limitations.
 */

var AudioPlayer = function (_EventTarget_1$defaul) {
    _inherits(AudioPlayer, _EventTarget_1$defaul);

    /**
     * @private
     */
    function AudioPlayer(audioContext) {
        var srcOrOptions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
        var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

        _classCallCheck(this, AudioPlayer);

        /**
         * The AudioBufferSourceNode of the actively loaded sound. Null if a sound
         *   has not been loaded yet. This is re-used for each time the sound is
         *   played.
         */
        var _this = _possibleConstructorReturn(this, (AudioPlayer.__proto__ || Object.getPrototypeOf(AudioPlayer)).call(this));

        _this._audioNode = null;
        /**
         * An Array of deferred-like objects for each pending `play` Promise. When
         *   .pause() is called or .src is set, all pending play Promises are
         *   immediately rejected.
         */
        _this._pendingPlayDeferreds = [];
        /**
         * Whether or not the audio element should loop. If disabled during playback,
         *   playing continues until the sound ends and then stops looping.
         */
        _this._loop = false;
        /**
         * The source URL of the sound to play. When set, the currently playing sound will stop.
         */
        _this._src = '';
        /**
         * The current sinkId of the device audio is being played through.
         */
        _this._sinkId = 'default';
        if (typeof srcOrOptions !== 'string') {
            options = srcOrOptions;
        }
        _this._audioContext = audioContext;
        _this._audioElement = new (options.AudioFactory || Audio)();
        _this._bufferPromise = _this._createPlayDeferred().promise;
        _this._destination = _this._audioContext.destination;
        _this._gainNode = _this._audioContext.createGain();
        _this._gainNode.connect(_this._destination);
        _this._XMLHttpRequest = options.XMLHttpRequestFactory || XMLHttpRequest;
        _this.addEventListener('canplaythrough', function () {
            _this._resolvePlayDeferreds();
        });
        if (typeof srcOrOptions === 'string') {
            _this.src = srcOrOptions;
        }
        return _this;
    }

    _createClass(AudioPlayer, [{
        key: "load",

        /**
         * Stop any ongoing playback and reload the source file.
         */
        value: function load() {
            this._load(this._src);
        }
        /**
         * Pause the audio coming from this AudioPlayer. This will reject any pending
         *   play Promises.
         */

    }, {
        key: "pause",
        value: function pause() {
            if (this.paused) {
                return;
            }
            this._audioElement.pause();
            this._audioNode.stop();
            this._audioNode.disconnect(this._gainNode);
            this._audioNode = null;
            this._rejectPlayDeferreds(new Error('The play() request was interrupted by a call to pause().'));
        }
        /**
         * Play the sound. If the buffer hasn't loaded yet, wait for the buffer to load. If
         *   the source URL is not set yet, this Promise will remain pending until a source
         *   URL is set.
         */

    }, {
        key: "play",
        value: function play() {
            return __awaiter(this, void 0, void 0, /*#__PURE__*/_regenerator2.default.mark(function _callee() {
                var _this2 = this;

                var buffer;
                return _regenerator2.default.wrap(function _callee$(_context) {
                    while (1) {
                        switch (_context.prev = _context.next) {
                            case 0:
                                if (this.paused) {
                                    _context.next = 6;
                                    break;
                                }

                                _context.next = 3;
                                return this._bufferPromise;

                            case 3:
                                if (this.paused) {
                                    _context.next = 5;
                                    break;
                                }

                                return _context.abrupt("return");

                            case 5:
                                throw new Error('The play() request was interrupted by a call to pause().');

                            case 6:
                                this._audioNode = this._audioContext.createBufferSource();
                                this._audioNode.loop = this.loop;
                                this._audioNode.addEventListener('ended', function () {
                                    if (_this2._audioNode && _this2._audioNode.loop) {
                                        return;
                                    }
                                    _this2.dispatchEvent('ended');
                                });
                                _context.next = 11;
                                return this._bufferPromise;

                            case 11:
                                buffer = _context.sent;

                                if (!this.paused) {
                                    _context.next = 14;
                                    break;
                                }

                                throw new Error('The play() request was interrupted by a call to pause().');

                            case 14:
                                this._audioNode.buffer = buffer;
                                this._audioNode.connect(this._gainNode);
                                this._audioNode.start();

                                if (!this._audioElement.srcObject) {
                                    _context.next = 19;
                                    break;
                                }

                                return _context.abrupt("return", this._audioElement.play());

                            case 19:
                            case "end":
                                return _context.stop();
                        }
                    }
                }, _callee, this);
            }));
        }
        /**
         * Change which device the sound should play through.
         * @param sinkId - The sink of the device to play sound through.
         */

    }, {
        key: "setSinkId",
        value: function setSinkId(sinkId) {
            return __awaiter(this, void 0, void 0, /*#__PURE__*/_regenerator2.default.mark(function _callee2() {
                return _regenerator2.default.wrap(function _callee2$(_context2) {
                    while (1) {
                        switch (_context2.prev = _context2.next) {
                            case 0:
                                if (!(typeof this._audioElement.setSinkId !== 'function')) {
                                    _context2.next = 2;
                                    break;
                                }

                                throw new Error('This browser does not support setSinkId.');

                            case 2:
                                if (!(sinkId === this.sinkId)) {
                                    _context2.next = 4;
                                    break;
                                }

                                return _context2.abrupt("return");

                            case 4:
                                if (!(sinkId === 'default')) {
                                    _context2.next = 11;
                                    break;
                                }

                                if (!this.paused) {
                                    this._gainNode.disconnect(this._destination);
                                }
                                this._audioElement.srcObject = null;
                                this._destination = this._audioContext.destination;
                                this._gainNode.connect(this._destination);
                                this._sinkId = sinkId;
                                return _context2.abrupt("return");

                            case 11:
                                _context2.next = 13;
                                return this._audioElement.setSinkId(sinkId);

                            case 13:
                                if (!this._audioElement.srcObject) {
                                    _context2.next = 15;
                                    break;
                                }

                                return _context2.abrupt("return");

                            case 15:
                                this._gainNode.disconnect(this._audioContext.destination);
                                this._destination = this._audioContext.createMediaStreamDestination();
                                this._audioElement.srcObject = this._destination.stream;
                                this._sinkId = sinkId;
                                this._gainNode.connect(this._destination);

                            case 20:
                            case "end":
                                return _context2.stop();
                        }
                    }
                }, _callee2, this);
            }));
        }
        /**
         * Create a Deferred for a Promise that will be resolved when .src is set or rejected
         *   when .pause is called.
         */

    }, {
        key: "_createPlayDeferred",
        value: function _createPlayDeferred() {
            var deferred = new Deferred_1.default();
            this._pendingPlayDeferreds.push(deferred);
            return deferred;
        }
        /**
         * Stop current playback and load a sound file.
         * @param src - The source URL of the file to load
         */

    }, {
        key: "_load",
        value: function _load(src) {
            var _this3 = this;

            if (this._src && this._src !== src) {
                this.pause();
            }
            this._src = src;
            this._bufferPromise = new Promise(function (resolve, reject) {
                return __awaiter(_this3, void 0, void 0, /*#__PURE__*/_regenerator2.default.mark(function _callee3() {
                    var buffer;
                    return _regenerator2.default.wrap(function _callee3$(_context3) {
                        while (1) {
                            switch (_context3.prev = _context3.next) {
                                case 0:
                                    if (src) {
                                        _context3.next = 2;
                                        break;
                                    }

                                    return _context3.abrupt("return", this._createPlayDeferred().promise);

                                case 2:
                                    _context3.next = 4;
                                    return bufferSound(this._audioContext, this._XMLHttpRequest, src);

                                case 4:
                                    buffer = _context3.sent;

                                    this.dispatchEvent('canplaythrough');
                                    resolve(buffer);

                                case 7:
                                case "end":
                                    return _context3.stop();
                            }
                        }
                    }, _callee3, this);
                }));
            });
        }
        /**
         * Reject all deferreds for the Play promise.
         * @param reason
         */

    }, {
        key: "_rejectPlayDeferreds",
        value: function _rejectPlayDeferreds(reason) {
            var deferreds = this._pendingPlayDeferreds;
            deferreds.splice(0, deferreds.length).forEach(function (_ref) {
                var reject = _ref.reject;
                return reject(reason);
            });
        }
        /**
         * Resolve all deferreds for the Play promise.
         * @param result
         */

    }, {
        key: "_resolvePlayDeferreds",
        value: function _resolvePlayDeferreds(result) {
            var deferreds = this._pendingPlayDeferreds;
            deferreds.splice(0, deferreds.length).forEach(function (_ref2) {
                var resolve = _ref2.resolve;
                return resolve(result);
            });
        }
    }, {
        key: "destination",
        get: function get() {
            return this._destination;
        }
    }, {
        key: "loop",
        get: function get() {
            return this._loop;
        },
        set: function set(shouldLoop) {
            // If a sound is already looping, it should continue playing
            //   the current playthrough and then stop.
            if (!shouldLoop && this.loop && !this.paused) {
                var _pauseAfterPlaythrough = function _pauseAfterPlaythrough() {
                    self._audioNode.removeEventListener('ended', _pauseAfterPlaythrough);
                    self.pause();
                };

                var self = this;

                this._audioNode.addEventListener('ended', _pauseAfterPlaythrough);
            }
            this._loop = shouldLoop;
        }
        /**
         * Whether the audio element is muted.
         */

    }, {
        key: "muted",
        get: function get() {
            return this._gainNode.gain.value === 0;
        },
        set: function set(shouldBeMuted) {
            this._gainNode.gain.value = shouldBeMuted ? 0 : 1;
        }
        /**
         * Whether the sound is paused. this._audioNode only exists when sound is playing;
         *   otherwise AudioPlayer is considered paused.
         */

    }, {
        key: "paused",
        get: function get() {
            return this._audioNode === null;
        }
    }, {
        key: "src",
        get: function get() {
            return this._src;
        },
        set: function set(src) {
            this._load(src);
        }
    }, {
        key: "sinkId",
        get: function get() {
            return this._sinkId;
        }
    }]);

    return AudioPlayer;
}(EventTarget_1.default);

exports.default = AudioPlayer;
/**
 * Use XMLHttpRequest to load the AudioBuffer of a remote audio asset.
 * @private
 * @param context - The AudioContext to use to decode the audio data
 * @param RequestFactory - The XMLHttpRequest factory to build
 * @param src - The URL of the audio asset to load.
 * @returns A Promise containing the decoded AudioBuffer.
 */
// tslint:disable-next-line:variable-name
function bufferSound(context, RequestFactory, src) {
    return __awaiter(this, void 0, void 0, /*#__PURE__*/_regenerator2.default.mark(function _callee4() {
        var request, event;
        return _regenerator2.default.wrap(function _callee4$(_context4) {
            while (1) {
                switch (_context4.prev = _context4.next) {
                    case 0:
                        request = new RequestFactory();

                        request.open('GET', src, true);
                        request.responseType = 'arraybuffer';
                        _context4.next = 5;
                        return new Promise(function (resolve) {
                            request.addEventListener('load', resolve);
                            request.send();
                        });

                    case 5:
                        event = _context4.sent;
                        _context4.prev = 6;
                        return _context4.abrupt("return", context.decodeAudioData(event.target.response));

                    case 10:
                        _context4.prev = 10;
                        _context4.t0 = _context4["catch"](6);
                        return _context4.abrupt("return", new Promise(function (resolve) {
                            context.decodeAudioData(event.target.response, resolve);
                        }));

                    case 13:
                    case "end":
                        return _context4.stop();
                }
            }
        }, _callee4, this, [[6, 10]]);
    }));
}

},{"./Deferred":31,"./EventTarget":32,"babel-runtime/regenerator":34}],31:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

Object.defineProperty(exports, "__esModule", { value: true });

var Deferred = function () {
    function Deferred() {
        var _this = this;

        _classCallCheck(this, Deferred);

        this.promise = new Promise(function (resolve, reject) {
            _this._resolve = resolve;
            _this._reject = reject;
        });
    }

    _createClass(Deferred, [{
        key: "reject",
        get: function get() {
            return this._reject;
        }
    }, {
        key: "resolve",
        get: function get() {
            return this._resolve;
        }
    }]);

    return Deferred;
}();

exports.default = Deferred;

},{}],32:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

Object.defineProperty(exports, "__esModule", { value: true });
var events_1 = require("events");

var EventTarget = function () {
    function EventTarget() {
        _classCallCheck(this, EventTarget);

        this._eventEmitter = new events_1.EventEmitter();
    }

    _createClass(EventTarget, [{
        key: "addEventListener",
        value: function addEventListener(name, handler) {
            return this._eventEmitter.addListener(name, handler);
        }
    }, {
        key: "dispatchEvent",
        value: function dispatchEvent(name) {
            var _eventEmitter;

            for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
            }

            return (_eventEmitter = this._eventEmitter).emit.apply(_eventEmitter, [name].concat(args));
        }
    }, {
        key: "removeEventListener",
        value: function removeEventListener(name, handler) {
            return this._eventEmitter.removeListener(name, handler);
        }
    }]);

    return EventTarget;
}();

exports.default = EventTarget;

},{"events":37}],33:[function(require,module,exports){
'use strict';

var AudioPlayer = require('./AudioPlayer');

module.exports = AudioPlayer.default;
},{"./AudioPlayer":30}],34:[function(require,module,exports){
module.exports = require("regenerator-runtime");

},{"regenerator-runtime":40}],35:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function placeHoldersCount (b64) {
  var len = b64.length
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
}

function byteLength (b64) {
  // base64 is 4/3 + up to two characters of the original data
  return (b64.length * 3 / 4) - placeHoldersCount(b64)
}

function toByteArray (b64) {
  var i, l, tmp, placeHolders, arr
  var len = b64.length
  placeHolders = placeHoldersCount(b64)

  arr = new Arr((len * 3 / 4) - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0; i < l; i += 4) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = ((uint8[i] << 16) & 0xFF0000) + ((uint8[i + 1] << 8) & 0xFF00) + (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],36:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  get: function () {
    if (!(this instanceof Buffer)) {
      return undefined
    }
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  get: function () {
    if (!(this instanceof Buffer)) {
      return undefined
    }
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('Invalid typed array length')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (isArrayBuffer(value) || (value && isArrayBuffer(value.buffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  return fromObject(value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj) {
    if (ArrayBuffer.isView(obj) || 'length' in obj) {
      if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
        return createBuffer(0)
      }
      return fromArrayLike(obj)
    }

    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return fromArrayLike(obj.data)
    }
  }

  throw new TypeError('The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object.')
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (ArrayBuffer.isView(buf)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isArrayBuffer(string)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset  // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : new Buffer(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffers from another context (i.e. an iframe) do not pass the `instanceof` check
// but they should be treated as valid. See: https://github.com/feross/buffer/issues/166
function isArrayBuffer (obj) {
  return obj instanceof ArrayBuffer ||
    (obj != null && obj.constructor != null && obj.constructor.name === 'ArrayBuffer' &&
      typeof obj.byteLength === 'number')
}

function numberIsNaN (obj) {
  return obj !== obj // eslint-disable-line no-self-compare
}

},{"base64-js":35,"ieee754":38}],37:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        // At least give some kind of context to the user
        var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
        err.context = er;
        throw err;
      }
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],38:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],39:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],40:[function(require,module,exports){
/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// This method of obtaining a reference to the global object needs to be
// kept identical to the way it is obtained in runtime.js
var g = (function() { return this })() || Function("return this")();

// Use `getOwnPropertyNames` because not all browsers support calling
// `hasOwnProperty` on the global `self` object in a worker. See #183.
var hadRuntime = g.regeneratorRuntime &&
  Object.getOwnPropertyNames(g).indexOf("regeneratorRuntime") >= 0;

// Save the old regeneratorRuntime in case it needs to be restored later.
var oldRuntime = hadRuntime && g.regeneratorRuntime;

// Force reevalutation of runtime.js.
g.regeneratorRuntime = undefined;

module.exports = require("./runtime");

if (hadRuntime) {
  // Restore the original runtime.
  g.regeneratorRuntime = oldRuntime;
} else {
  // Remove the global property added by runtime.js.
  try {
    delete g.regeneratorRuntime;
  } catch(e) {
    g.regeneratorRuntime = undefined;
  }
}

},{"./runtime":41}],41:[function(require,module,exports){
/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

!(function(global) {
  "use strict";

  var Op = Object.prototype;
  var hasOwn = Op.hasOwnProperty;
  var undefined; // More compressible than void 0.
  var $Symbol = typeof Symbol === "function" ? Symbol : {};
  var iteratorSymbol = $Symbol.iterator || "@@iterator";
  var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
  var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

  var inModule = typeof module === "object";
  var runtime = global.regeneratorRuntime;
  if (runtime) {
    if (inModule) {
      // If regeneratorRuntime is defined globally and we're in a module,
      // make the exports object identical to regeneratorRuntime.
      module.exports = runtime;
    }
    // Don't bother evaluating the rest of this file if the runtime was
    // already defined globally.
    return;
  }

  // Define the runtime globally (as expected by generated code) as either
  // module.exports (if we're in a module) or a new, empty object.
  runtime = global.regeneratorRuntime = inModule ? module.exports : {};

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
    var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
    var generator = Object.create(protoGenerator.prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    generator._invoke = makeInvokeMethod(innerFn, self, context);

    return generator;
  }
  runtime.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  // This is a polyfill for %IteratorPrototype% for environments that
  // don't natively support it.
  var IteratorPrototype = {};
  IteratorPrototype[iteratorSymbol] = function () {
    return this;
  };

  var getProto = Object.getPrototypeOf;
  var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
  if (NativeIteratorPrototype &&
      NativeIteratorPrototype !== Op &&
      hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
    // This environment has a native %IteratorPrototype%; use it instead
    // of the polyfill.
    IteratorPrototype = NativeIteratorPrototype;
  }

  var Gp = GeneratorFunctionPrototype.prototype =
    Generator.prototype = Object.create(IteratorPrototype);
  GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
  GeneratorFunctionPrototype.constructor = GeneratorFunction;
  GeneratorFunctionPrototype[toStringTagSymbol] =
    GeneratorFunction.displayName = "GeneratorFunction";

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      prototype[method] = function(arg) {
        return this._invoke(method, arg);
      };
    });
  }

  runtime.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  runtime.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
      if (!(toStringTagSymbol in genFun)) {
        genFun[toStringTagSymbol] = "GeneratorFunction";
      }
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `hasOwn.call(value, "__await")` to determine if the yielded value is
  // meant to be awaited.
  runtime.awrap = function(arg) {
    return { __await: arg };
  };

  function AsyncIterator(generator) {
    function invoke(method, arg, resolve, reject) {
      var record = tryCatch(generator[method], generator, arg);
      if (record.type === "throw") {
        reject(record.arg);
      } else {
        var result = record.arg;
        var value = result.value;
        if (value &&
            typeof value === "object" &&
            hasOwn.call(value, "__await")) {
          return Promise.resolve(value.__await).then(function(value) {
            invoke("next", value, resolve, reject);
          }, function(err) {
            invoke("throw", err, resolve, reject);
          });
        }

        return Promise.resolve(value).then(function(unwrapped) {
          // When a yielded Promise is resolved, its final value becomes
          // the .value of the Promise<{value,done}> result for the
          // current iteration. If the Promise is rejected, however, the
          // result for this iteration will be rejected with the same
          // reason. Note that rejections of yielded Promises are not
          // thrown back into the generator function, as is the case
          // when an awaited Promise is rejected. This difference in
          // behavior between yield and await is important, because it
          // allows the consumer to decide what to do with the yielded
          // rejection (swallow it and continue, manually .throw it back
          // into the generator, abandon iteration, whatever). With
          // await, by contrast, there is no opportunity to examine the
          // rejection reason outside the generator function, so the
          // only option is to throw it from the await expression, and
          // let the generator function handle the exception.
          result.value = unwrapped;
          resolve(result);
        }, reject);
      }
    }

    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return new Promise(function(resolve, reject) {
          invoke(method, arg, resolve, reject);
        });
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : callInvokeWithMethodAndArg();
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    this._invoke = enqueue;
  }

  defineIteratorMethods(AsyncIterator.prototype);
  AsyncIterator.prototype[asyncIteratorSymbol] = function () {
    return this;
  };
  runtime.AsyncIterator = AsyncIterator;

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  runtime.async = function(innerFn, outerFn, self, tryLocsList) {
    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList)
    );

    return runtime.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per 25.3.3.3.3 of the spec:
        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
        return doneResult();
      }

      context.method = method;
      context.arg = arg;

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          var delegateResult = maybeInvokeDelegate(delegate, context);
          if (delegateResult) {
            if (delegateResult === ContinueSentinel) continue;
            return delegateResult;
          }
        }

        if (context.method === "next") {
          // Setting context._sent for legacy support of Babel's
          // function.sent implementation.
          context.sent = context._sent = context.arg;

        } else if (context.method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw context.arg;
          }

          context.dispatchException(context.arg);

        } else if (context.method === "return") {
          context.abrupt("return", context.arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          if (record.arg === ContinueSentinel) {
            continue;
          }

          return {
            value: record.arg,
            done: context.done
          };

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(context.arg) call above.
          context.method = "throw";
          context.arg = record.arg;
        }
      }
    };
  }

  // Call delegate.iterator[context.method](context.arg) and handle the
  // result, either by returning a { value, done } result from the
  // delegate iterator, or by modifying context.method and context.arg,
  // setting context.delegate to null, and returning the ContinueSentinel.
  function maybeInvokeDelegate(delegate, context) {
    var method = delegate.iterator[context.method];
    if (method === undefined) {
      // A .throw or .return when the delegate iterator has no .throw
      // method always terminates the yield* loop.
      context.delegate = null;

      if (context.method === "throw") {
        if (delegate.iterator.return) {
          // If the delegate iterator has a return method, give it a
          // chance to clean up.
          context.method = "return";
          context.arg = undefined;
          maybeInvokeDelegate(delegate, context);

          if (context.method === "throw") {
            // If maybeInvokeDelegate(context) changed context.method from
            // "return" to "throw", let that override the TypeError below.
            return ContinueSentinel;
          }
        }

        context.method = "throw";
        context.arg = new TypeError(
          "The iterator does not provide a 'throw' method");
      }

      return ContinueSentinel;
    }

    var record = tryCatch(method, delegate.iterator, context.arg);

    if (record.type === "throw") {
      context.method = "throw";
      context.arg = record.arg;
      context.delegate = null;
      return ContinueSentinel;
    }

    var info = record.arg;

    if (! info) {
      context.method = "throw";
      context.arg = new TypeError("iterator result is not an object");
      context.delegate = null;
      return ContinueSentinel;
    }

    if (info.done) {
      // Assign the result of the finished delegate to the temporary
      // variable specified by delegate.resultName (see delegateYield).
      context[delegate.resultName] = info.value;

      // Resume execution at the desired location (see delegateYield).
      context.next = delegate.nextLoc;

      // If context.method was "throw" but the delegate handled the
      // exception, let the outer generator proceed normally. If
      // context.method was "next", forget context.arg since it has been
      // "consumed" by the delegate iterator. If context.method was
      // "return", allow the original .return call to continue in the
      // outer generator.
      if (context.method !== "return") {
        context.method = "next";
        context.arg = undefined;
      }

    } else {
      // Re-yield the result returned by the delegate method.
      return info;
    }

    // The delegate iterator is finished, so forget it and continue with
    // the outer generator.
    context.delegate = null;
    return ContinueSentinel;
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  Gp[toStringTagSymbol] = "Generator";

  // A Generator should always return itself as the iterator object when the
  // @@iterator function is called on it. Some browsers' implementations of the
  // iterator prototype chain incorrectly implement this, causing the Generator
  // object to not be returned from this call. This ensures that doesn't happen.
  // See https://github.com/facebook/regenerator/issues/274 for more details.
  Gp[iteratorSymbol] = function() {
    return this;
  };

  Gp.toString = function() {
    return "[object Generator]";
  };

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  runtime.keys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    // Return an iterator with no values.
    return { next: doneResult };
  }
  runtime.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      // Resetting context._sent for legacy support of Babel's
      // function.sent implementation.
      this.sent = this._sent = undefined;
      this.done = false;
      this.delegate = null;

      this.method = "next";
      this.arg = undefined;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;

        if (caught) {
          // If the dispatched exception was caught by a catch block,
          // then let that catch block handle the exception normally.
          context.method = "next";
          context.arg = undefined;
        }

        return !! caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.method = "next";
        this.next = finallyEntry.finallyLoc;
        return ContinueSentinel;
      }

      return this.complete(record);
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = this.arg = record.arg;
        this.method = "return";
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }

      return ContinueSentinel;
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      if (this.method === "next") {
        // Deliberately forget the last sent value so that we don't
        // accidentally pass it on to the delegate.
        this.arg = undefined;
      }

      return ContinueSentinel;
    }
  };
})(
  // In sloppy mode, unbound `this` refers to the global object, fallback to
  // Function constructor if we're in global strict mode. That is sadly a form
  // of indirect eval which violates Content Security Policy.
  (function() { return this })() || Function("return this")()
);

},{}],42:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var SDPUtils = require('sdp');

function writeMediaSection(transceiver, caps, type, stream, dtlsRole) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
      transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
      transceiver.dtlsTransport.getLocalParameters(),
      type === 'offer' ? 'actpass' : dtlsRole || 'active');

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    var trackId = transceiver.rtpSender._initialTrackId ||
        transceiver.rtpSender.track.id;
    transceiver.rtpSender._initialTrackId = trackId;
    // spec.
    var msid = 'msid:' + (stream ? stream.id : '-') + ' ' +
        trackId + '\r\n';
    sdp += 'a=' + msid;
    // for Chrome. Legacy should no longer be required.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;

    // RTX
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
}

// Edge does not like
// 1) stun: filtered after 14393 unless ?transport=udp is present
// 2) turn: that does not have all of turn:host:port?transport=udp
// 3) turn: with ipv6 addresses
// 4) turn: occurring muliple times
function filterIceServers(iceServers, edgeVersion) {
  var hasTurn = false;
  iceServers = JSON.parse(JSON.stringify(iceServers));
  return iceServers.filter(function(server) {
    if (server && (server.urls || server.url)) {
      var urls = server.urls || server.url;
      if (server.url && !server.urls) {
        console.warn('RTCIceServer.url is deprecated! Use urls instead.');
      }
      var isString = typeof urls === 'string';
      if (isString) {
        urls = [urls];
      }
      urls = urls.filter(function(url) {
        var validTurn = url.indexOf('turn:') === 0 &&
            url.indexOf('transport=udp') !== -1 &&
            url.indexOf('turn:[') === -1 &&
            !hasTurn;

        if (validTurn) {
          hasTurn = true;
          return true;
        }
        return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
            url.indexOf('?transport=udp') === -1;
      });

      delete server.url;
      server.urls = isString ? urls[0] : urls;
      return !!urls.length;
    }
  });
}

// Determines the intersection of local and remote capabilities.
function getCommonCapabilities(localCapabilities, remoteCapabilities) {
  var commonCapabilities = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: []
  };

  var findCodecByPayloadType = function(pt, codecs) {
    pt = parseInt(pt, 10);
    for (var i = 0; i < codecs.length; i++) {
      if (codecs[i].payloadType === pt ||
          codecs[i].preferredPayloadType === pt) {
        return codecs[i];
      }
    }
  };

  var rtxCapabilityMatches = function(lRtx, rRtx, lCodecs, rCodecs) {
    var lCodec = findCodecByPayloadType(lRtx.parameters.apt, lCodecs);
    var rCodec = findCodecByPayloadType(rRtx.parameters.apt, rCodecs);
    return lCodec && rCodec &&
        lCodec.name.toLowerCase() === rCodec.name.toLowerCase();
  };

  localCapabilities.codecs.forEach(function(lCodec) {
    for (var i = 0; i < remoteCapabilities.codecs.length; i++) {
      var rCodec = remoteCapabilities.codecs[i];
      if (lCodec.name.toLowerCase() === rCodec.name.toLowerCase() &&
          lCodec.clockRate === rCodec.clockRate) {
        if (lCodec.name.toLowerCase() === 'rtx' &&
            lCodec.parameters && rCodec.parameters.apt) {
          // for RTX we need to find the local rtx that has a apt
          // which points to the same local codec as the remote one.
          if (!rtxCapabilityMatches(lCodec, rCodec,
              localCapabilities.codecs, remoteCapabilities.codecs)) {
            continue;
          }
        }
        rCodec = JSON.parse(JSON.stringify(rCodec)); // deepcopy
        // number of channels is the highest common number of channels
        rCodec.numChannels = Math.min(lCodec.numChannels,
            rCodec.numChannels);
        // push rCodec so we reply with offerer payload type
        commonCapabilities.codecs.push(rCodec);

        // determine common feedback mechanisms
        rCodec.rtcpFeedback = rCodec.rtcpFeedback.filter(function(fb) {
          for (var j = 0; j < lCodec.rtcpFeedback.length; j++) {
            if (lCodec.rtcpFeedback[j].type === fb.type &&
                lCodec.rtcpFeedback[j].parameter === fb.parameter) {
              return true;
            }
          }
          return false;
        });
        // FIXME: also need to determine .parameters
        //  see https://github.com/openpeer/ortc/issues/569
        break;
      }
    }
  });

  localCapabilities.headerExtensions.forEach(function(lHeaderExtension) {
    for (var i = 0; i < remoteCapabilities.headerExtensions.length;
         i++) {
      var rHeaderExtension = remoteCapabilities.headerExtensions[i];
      if (lHeaderExtension.uri === rHeaderExtension.uri) {
        commonCapabilities.headerExtensions.push(rHeaderExtension);
        break;
      }
    }
  });

  // FIXME: fecMechanisms
  return commonCapabilities;
}

// is action=setLocalDescription with type allowed in signalingState
function isActionAllowedInSignalingState(action, type, signalingState) {
  return {
    offer: {
      setLocalDescription: ['stable', 'have-local-offer'],
      setRemoteDescription: ['stable', 'have-remote-offer']
    },
    answer: {
      setLocalDescription: ['have-remote-offer', 'have-local-pranswer'],
      setRemoteDescription: ['have-local-offer', 'have-remote-pranswer']
    }
  }[type][action].indexOf(signalingState) !== -1;
}

function maybeAddCandidate(iceTransport, candidate) {
  // Edge's internal representation adds some fields therefore
  // not all fieldѕ are taken into account.
  var alreadyAdded = iceTransport.getRemoteCandidates()
      .find(function(remoteCandidate) {
        return candidate.foundation === remoteCandidate.foundation &&
            candidate.ip === remoteCandidate.ip &&
            candidate.port === remoteCandidate.port &&
            candidate.priority === remoteCandidate.priority &&
            candidate.protocol === remoteCandidate.protocol &&
            candidate.type === remoteCandidate.type;
      });
  if (!alreadyAdded) {
    iceTransport.addRemoteCandidate(candidate);
  }
  return !alreadyAdded;
}


function makeError(name, description) {
  var e = new Error(description);
  e.name = name;
  // legacy error codes from https://heycam.github.io/webidl/#idl-DOMException-error-names
  e.code = {
    NotSupportedError: 9,
    InvalidStateError: 11,
    InvalidAccessError: 15,
    TypeError: undefined,
    OperationError: undefined
  }[name];
  return e;
}

module.exports = function(window, edgeVersion) {
  // https://w3c.github.io/mediacapture-main/#mediastream
  // Helper function to add the track to the stream and
  // dispatch the event ourselves.
  function addTrackToStreamAndFireEvent(track, stream) {
    stream.addTrack(track);
    stream.dispatchEvent(new window.MediaStreamTrackEvent('addtrack',
        {track: track}));
  }

  function removeTrackFromStreamAndFireEvent(track, stream) {
    stream.removeTrack(track);
    stream.dispatchEvent(new window.MediaStreamTrackEvent('removetrack',
        {track: track}));
  }

  function fireAddTrack(pc, track, receiver, streams) {
    var trackEvent = new Event('track');
    trackEvent.track = track;
    trackEvent.receiver = receiver;
    trackEvent.transceiver = {receiver: receiver};
    trackEvent.streams = streams;
    window.setTimeout(function() {
      pc._dispatchEvent('track', trackEvent);
    });
  }

  var RTCPeerConnection = function(config) {
    var pc = this;

    var _eventTarget = document.createDocumentFragment();
    ['addEventListener', 'removeEventListener', 'dispatchEvent']
        .forEach(function(method) {
          pc[method] = _eventTarget[method].bind(_eventTarget);
        });

    this.canTrickleIceCandidates = null;

    this.needNegotiation = false;

    this.localStreams = [];
    this.remoteStreams = [];

    this.localDescription = null;
    this.remoteDescription = null;

    this.signalingState = 'stable';
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.iceGatheringState = 'new';

    config = JSON.parse(JSON.stringify(config || {}));

    this.usingBundle = config.bundlePolicy === 'max-bundle';
    if (config.rtcpMuxPolicy === 'negotiate') {
      throw(makeError('NotSupportedError',
          'rtcpMuxPolicy \'negotiate\' is not supported'));
    } else if (!config.rtcpMuxPolicy) {
      config.rtcpMuxPolicy = 'require';
    }

    switch (config.iceTransportPolicy) {
      case 'all':
      case 'relay':
        break;
      default:
        config.iceTransportPolicy = 'all';
        break;
    }

    switch (config.bundlePolicy) {
      case 'balanced':
      case 'max-compat':
      case 'max-bundle':
        break;
      default:
        config.bundlePolicy = 'balanced';
        break;
    }

    config.iceServers = filterIceServers(config.iceServers || [], edgeVersion);

    this._iceGatherers = [];
    if (config.iceCandidatePoolSize) {
      for (var i = config.iceCandidatePoolSize; i > 0; i--) {
        this._iceGatherers.push(new window.RTCIceGatherer({
          iceServers: config.iceServers,
          gatherPolicy: config.iceTransportPolicy
        }));
      }
    } else {
      config.iceCandidatePoolSize = 0;
    }

    this._config = config;

    // per-track iceGathers, iceTransports, dtlsTransports, rtpSenders, ...
    // everything that is needed to describe a SDP m-line.
    this.transceivers = [];

    this._sdpSessionId = SDPUtils.generateSessionId();
    this._sdpSessionVersion = 0;

    this._dtlsRole = undefined; // role for a=setup to use in answers.

    this._isClosed = false;
  };

  // set up event handlers on prototype
  RTCPeerConnection.prototype.onicecandidate = null;
  RTCPeerConnection.prototype.onaddstream = null;
  RTCPeerConnection.prototype.ontrack = null;
  RTCPeerConnection.prototype.onremovestream = null;
  RTCPeerConnection.prototype.onsignalingstatechange = null;
  RTCPeerConnection.prototype.oniceconnectionstatechange = null;
  RTCPeerConnection.prototype.onconnectionstatechange = null;
  RTCPeerConnection.prototype.onicegatheringstatechange = null;
  RTCPeerConnection.prototype.onnegotiationneeded = null;
  RTCPeerConnection.prototype.ondatachannel = null;

  RTCPeerConnection.prototype._dispatchEvent = function(name, event) {
    if (this._isClosed) {
      return;
    }
    this.dispatchEvent(event);
    if (typeof this['on' + name] === 'function') {
      this['on' + name](event);
    }
  };

  RTCPeerConnection.prototype._emitGatheringStateChange = function() {
    var event = new Event('icegatheringstatechange');
    this._dispatchEvent('icegatheringstatechange', event);
  };

  RTCPeerConnection.prototype.getConfiguration = function() {
    return this._config;
  };

  RTCPeerConnection.prototype.getLocalStreams = function() {
    return this.localStreams;
  };

  RTCPeerConnection.prototype.getRemoteStreams = function() {
    return this.remoteStreams;
  };

  // internal helper to create a transceiver object.
  // (which is not yet the same as the WebRTC 1.0 transceiver)
  RTCPeerConnection.prototype._createTransceiver = function(kind, doNotAdd) {
    var hasBundleTransport = this.transceivers.length > 0;
    var transceiver = {
      track: null,
      iceGatherer: null,
      iceTransport: null,
      dtlsTransport: null,
      localCapabilities: null,
      remoteCapabilities: null,
      rtpSender: null,
      rtpReceiver: null,
      kind: kind,
      mid: null,
      sendEncodingParameters: null,
      recvEncodingParameters: null,
      stream: null,
      associatedRemoteMediaStreams: [],
      wantReceive: true
    };
    if (this.usingBundle && hasBundleTransport) {
      transceiver.iceTransport = this.transceivers[0].iceTransport;
      transceiver.dtlsTransport = this.transceivers[0].dtlsTransport;
    } else {
      var transports = this._createIceAndDtlsTransports();
      transceiver.iceTransport = transports.iceTransport;
      transceiver.dtlsTransport = transports.dtlsTransport;
    }
    if (!doNotAdd) {
      this.transceivers.push(transceiver);
    }
    return transceiver;
  };

  RTCPeerConnection.prototype.addTrack = function(track, stream) {
    if (this._isClosed) {
      throw makeError('InvalidStateError',
          'Attempted to call addTrack on a closed peerconnection.');
    }

    var alreadyExists = this.transceivers.find(function(s) {
      return s.track === track;
    });

    if (alreadyExists) {
      throw makeError('InvalidAccessError', 'Track already exists.');
    }

    var transceiver;
    for (var i = 0; i < this.transceivers.length; i++) {
      if (!this.transceivers[i].track &&
          this.transceivers[i].kind === track.kind) {
        transceiver = this.transceivers[i];
      }
    }
    if (!transceiver) {
      transceiver = this._createTransceiver(track.kind);
    }

    this._maybeFireNegotiationNeeded();

    if (this.localStreams.indexOf(stream) === -1) {
      this.localStreams.push(stream);
    }

    transceiver.track = track;
    transceiver.stream = stream;
    transceiver.rtpSender = new window.RTCRtpSender(track,
        transceiver.dtlsTransport);
    return transceiver.rtpSender;
  };

  RTCPeerConnection.prototype.addStream = function(stream) {
    var pc = this;
    if (edgeVersion >= 15025) {
      stream.getTracks().forEach(function(track) {
        pc.addTrack(track, stream);
      });
    } else {
      // Clone is necessary for local demos mostly, attaching directly
      // to two different senders does not work (build 10547).
      // Fixed in 15025 (or earlier)
      var clonedStream = stream.clone();
      stream.getTracks().forEach(function(track, idx) {
        var clonedTrack = clonedStream.getTracks()[idx];
        track.addEventListener('enabled', function(event) {
          clonedTrack.enabled = event.enabled;
        });
      });
      clonedStream.getTracks().forEach(function(track) {
        pc.addTrack(track, clonedStream);
      });
    }
  };

  RTCPeerConnection.prototype.removeTrack = function(sender) {
    if (this._isClosed) {
      throw makeError('InvalidStateError',
          'Attempted to call removeTrack on a closed peerconnection.');
    }

    if (!(sender instanceof window.RTCRtpSender)) {
      throw new TypeError('Argument 1 of RTCPeerConnection.removeTrack ' +
          'does not implement interface RTCRtpSender.');
    }

    var transceiver = this.transceivers.find(function(t) {
      return t.rtpSender === sender;
    });

    if (!transceiver) {
      throw makeError('InvalidAccessError',
          'Sender was not created by this connection.');
    }
    var stream = transceiver.stream;

    transceiver.rtpSender.stop();
    transceiver.rtpSender = null;
    transceiver.track = null;
    transceiver.stream = null;

    // remove the stream from the set of local streams
    var localStreams = this.transceivers.map(function(t) {
      return t.stream;
    });
    if (localStreams.indexOf(stream) === -1 &&
        this.localStreams.indexOf(stream) > -1) {
      this.localStreams.splice(this.localStreams.indexOf(stream), 1);
    }

    this._maybeFireNegotiationNeeded();
  };

  RTCPeerConnection.prototype.removeStream = function(stream) {
    var pc = this;
    stream.getTracks().forEach(function(track) {
      var sender = pc.getSenders().find(function(s) {
        return s.track === track;
      });
      if (sender) {
        pc.removeTrack(sender);
      }
    });
  };

  RTCPeerConnection.prototype.getSenders = function() {
    return this.transceivers.filter(function(transceiver) {
      return !!transceiver.rtpSender;
    })
    .map(function(transceiver) {
      return transceiver.rtpSender;
    });
  };

  RTCPeerConnection.prototype.getReceivers = function() {
    return this.transceivers.filter(function(transceiver) {
      return !!transceiver.rtpReceiver;
    })
    .map(function(transceiver) {
      return transceiver.rtpReceiver;
    });
  };


  RTCPeerConnection.prototype._createIceGatherer = function(sdpMLineIndex,
      usingBundle) {
    var pc = this;
    if (usingBundle && sdpMLineIndex > 0) {
      return this.transceivers[0].iceGatherer;
    } else if (this._iceGatherers.length) {
      return this._iceGatherers.shift();
    }
    var iceGatherer = new window.RTCIceGatherer({
      iceServers: this._config.iceServers,
      gatherPolicy: this._config.iceTransportPolicy
    });
    Object.defineProperty(iceGatherer, 'state',
        {value: 'new', writable: true}
    );

    this.transceivers[sdpMLineIndex].bufferedCandidateEvents = [];
    this.transceivers[sdpMLineIndex].bufferCandidates = function(event) {
      var end = !event.candidate || Object.keys(event.candidate).length === 0;
      // polyfill since RTCIceGatherer.state is not implemented in
      // Edge 10547 yet.
      iceGatherer.state = end ? 'completed' : 'gathering';
      if (pc.transceivers[sdpMLineIndex].bufferedCandidateEvents !== null) {
        pc.transceivers[sdpMLineIndex].bufferedCandidateEvents.push(event);
      }
    };
    iceGatherer.addEventListener('localcandidate',
      this.transceivers[sdpMLineIndex].bufferCandidates);
    return iceGatherer;
  };

  // start gathering from an RTCIceGatherer.
  RTCPeerConnection.prototype._gather = function(mid, sdpMLineIndex) {
    var pc = this;
    var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
    if (iceGatherer.onlocalcandidate) {
      return;
    }
    var bufferedCandidateEvents =
      this.transceivers[sdpMLineIndex].bufferedCandidateEvents;
    this.transceivers[sdpMLineIndex].bufferedCandidateEvents = null;
    iceGatherer.removeEventListener('localcandidate',
      this.transceivers[sdpMLineIndex].bufferCandidates);
    iceGatherer.onlocalcandidate = function(evt) {
      if (pc.usingBundle && sdpMLineIndex > 0) {
        // if we know that we use bundle we can drop candidates with
        // ѕdpMLineIndex > 0. If we don't do this then our state gets
        // confused since we dispose the extra ice gatherer.
        return;
      }
      var event = new Event('icecandidate');
      event.candidate = {sdpMid: mid, sdpMLineIndex: sdpMLineIndex};

      var cand = evt.candidate;
      // Edge emits an empty object for RTCIceCandidateComplete‥
      var end = !cand || Object.keys(cand).length === 0;
      if (end) {
        // polyfill since RTCIceGatherer.state is not implemented in
        // Edge 10547 yet.
        if (iceGatherer.state === 'new' || iceGatherer.state === 'gathering') {
          iceGatherer.state = 'completed';
        }
      } else {
        if (iceGatherer.state === 'new') {
          iceGatherer.state = 'gathering';
        }
        // RTCIceCandidate doesn't have a component, needs to be added
        cand.component = 1;
        // also the usernameFragment. TODO: update SDP to take both variants.
        cand.ufrag = iceGatherer.getLocalParameters().usernameFragment;

        var serializedCandidate = SDPUtils.writeCandidate(cand);
        event.candidate = Object.assign(event.candidate,
            SDPUtils.parseCandidate(serializedCandidate));

        event.candidate.candidate = serializedCandidate;
        event.candidate.toJSON = function() {
          return {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment
          };
        };
      }

      // update local description.
      var sections = SDPUtils.getMediaSections(pc.localDescription.sdp);
      if (!end) {
        sections[event.candidate.sdpMLineIndex] +=
            'a=' + event.candidate.candidate + '\r\n';
      } else {
        sections[event.candidate.sdpMLineIndex] +=
            'a=end-of-candidates\r\n';
      }
      pc.localDescription.sdp =
          SDPUtils.getDescription(pc.localDescription.sdp) +
          sections.join('');
      var complete = pc.transceivers.every(function(transceiver) {
        return transceiver.iceGatherer &&
            transceiver.iceGatherer.state === 'completed';
      });

      if (pc.iceGatheringState !== 'gathering') {
        pc.iceGatheringState = 'gathering';
        pc._emitGatheringStateChange();
      }

      // Emit candidate. Also emit null candidate when all gatherers are
      // complete.
      if (!end) {
        pc._dispatchEvent('icecandidate', event);
      }
      if (complete) {
        pc._dispatchEvent('icecandidate', new Event('icecandidate'));
        pc.iceGatheringState = 'complete';
        pc._emitGatheringStateChange();
      }
    };

    // emit already gathered candidates.
    window.setTimeout(function() {
      bufferedCandidateEvents.forEach(function(e) {
        iceGatherer.onlocalcandidate(e);
      });
    }, 0);
  };

  // Create ICE transport and DTLS transport.
  RTCPeerConnection.prototype._createIceAndDtlsTransports = function() {
    var pc = this;
    var iceTransport = new window.RTCIceTransport(null);
    iceTransport.onicestatechange = function() {
      pc._updateIceConnectionState();
      pc._updateConnectionState();
    };

    var dtlsTransport = new window.RTCDtlsTransport(iceTransport);
    dtlsTransport.ondtlsstatechange = function() {
      pc._updateConnectionState();
    };
    dtlsTransport.onerror = function() {
      // onerror does not set state to failed by itself.
      Object.defineProperty(dtlsTransport, 'state',
          {value: 'failed', writable: true});
      pc._updateConnectionState();
    };

    return {
      iceTransport: iceTransport,
      dtlsTransport: dtlsTransport
    };
  };

  // Destroy ICE gatherer, ICE transport and DTLS transport.
  // Without triggering the callbacks.
  RTCPeerConnection.prototype._disposeIceAndDtlsTransports = function(
      sdpMLineIndex) {
    var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
    if (iceGatherer) {
      delete iceGatherer.onlocalcandidate;
      delete this.transceivers[sdpMLineIndex].iceGatherer;
    }
    var iceTransport = this.transceivers[sdpMLineIndex].iceTransport;
    if (iceTransport) {
      delete iceTransport.onicestatechange;
      delete this.transceivers[sdpMLineIndex].iceTransport;
    }
    var dtlsTransport = this.transceivers[sdpMLineIndex].dtlsTransport;
    if (dtlsTransport) {
      delete dtlsTransport.ondtlsstatechange;
      delete dtlsTransport.onerror;
      delete this.transceivers[sdpMLineIndex].dtlsTransport;
    }
  };

  // Start the RTP Sender and Receiver for a transceiver.
  RTCPeerConnection.prototype._transceive = function(transceiver,
      send, recv) {
    var params = getCommonCapabilities(transceiver.localCapabilities,
        transceiver.remoteCapabilities);
    if (send && transceiver.rtpSender) {
      params.encodings = transceiver.sendEncodingParameters;
      params.rtcp = {
        cname: SDPUtils.localCName,
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.recvEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.recvEncodingParameters[0].ssrc;
      }
      transceiver.rtpSender.send(params);
    }
    if (recv && transceiver.rtpReceiver && params.codecs.length > 0) {
      // remove RTX field in Edge 14942
      if (transceiver.kind === 'video'
          && transceiver.recvEncodingParameters
          && edgeVersion < 15019) {
        transceiver.recvEncodingParameters.forEach(function(p) {
          delete p.rtx;
        });
      }
      if (transceiver.recvEncodingParameters.length) {
        params.encodings = transceiver.recvEncodingParameters;
      } else {
        params.encodings = [{}];
      }
      params.rtcp = {
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.rtcpParameters.cname) {
        params.rtcp.cname = transceiver.rtcpParameters.cname;
      }
      if (transceiver.sendEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.sendEncodingParameters[0].ssrc;
      }
      transceiver.rtpReceiver.receive(params);
    }
  };

  RTCPeerConnection.prototype.setLocalDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(makeError('TypeError',
          'Unsupported type "' + description.type + '"'));
    }

    if (!isActionAllowedInSignalingState('setLocalDescription',
        description.type, pc.signalingState) || pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not set local ' + description.type +
          ' in state ' + pc.signalingState));
    }

    var sections;
    var sessionpart;
    if (description.type === 'offer') {
      // VERY limited support for SDP munging. Limited to:
      // * changing the order of codecs
      sections = SDPUtils.splitSections(description.sdp);
      sessionpart = sections.shift();
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var caps = SDPUtils.parseRtpParameters(mediaSection);
        pc.transceivers[sdpMLineIndex].localCapabilities = caps;
      });

      pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
        pc._gather(transceiver.mid, sdpMLineIndex);
      });
    } else if (description.type === 'answer') {
      sections = SDPUtils.splitSections(pc.remoteDescription.sdp);
      sessionpart = sections.shift();
      var isIceLite = SDPUtils.matchPrefix(sessionpart,
          'a=ice-lite').length > 0;
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var transceiver = pc.transceivers[sdpMLineIndex];
        var iceGatherer = transceiver.iceGatherer;
        var iceTransport = transceiver.iceTransport;
        var dtlsTransport = transceiver.dtlsTransport;
        var localCapabilities = transceiver.localCapabilities;
        var remoteCapabilities = transceiver.remoteCapabilities;

        // treat bundle-only as not-rejected.
        var rejected = SDPUtils.isRejected(mediaSection) &&
            SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;

        if (!rejected && !transceiver.rejected) {
          var remoteIceParameters = SDPUtils.getIceParameters(
              mediaSection, sessionpart);
          var remoteDtlsParameters = SDPUtils.getDtlsParameters(
              mediaSection, sessionpart);
          if (isIceLite) {
            remoteDtlsParameters.role = 'server';
          }

          if (!pc.usingBundle || sdpMLineIndex === 0) {
            pc._gather(transceiver.mid, sdpMLineIndex);
            if (iceTransport.state === 'new') {
              iceTransport.start(iceGatherer, remoteIceParameters,
                  isIceLite ? 'controlling' : 'controlled');
            }
            if (dtlsTransport.state === 'new') {
              dtlsTransport.start(remoteDtlsParameters);
            }
          }

          // Calculate intersection of capabilities.
          var params = getCommonCapabilities(localCapabilities,
              remoteCapabilities);

          // Start the RTCRtpSender. The RTCRtpReceiver for this
          // transceiver has already been started in setRemoteDescription.
          pc._transceive(transceiver,
              params.codecs.length > 0,
              false);
        }
      });
    }

    pc.localDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-local-offer');
    } else {
      pc._updateSignalingState('stable');
    }

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.setRemoteDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(makeError('TypeError',
          'Unsupported type "' + description.type + '"'));
    }

    if (!isActionAllowedInSignalingState('setRemoteDescription',
        description.type, pc.signalingState) || pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not set remote ' + description.type +
          ' in state ' + pc.signalingState));
    }

    var streams = {};
    pc.remoteStreams.forEach(function(stream) {
      streams[stream.id] = stream;
    });
    var receiverList = [];
    var sections = SDPUtils.splitSections(description.sdp);
    var sessionpart = sections.shift();
    var isIceLite = SDPUtils.matchPrefix(sessionpart,
        'a=ice-lite').length > 0;
    var usingBundle = SDPUtils.matchPrefix(sessionpart,
        'a=group:BUNDLE ').length > 0;
    pc.usingBundle = usingBundle;
    var iceOptions = SDPUtils.matchPrefix(sessionpart,
        'a=ice-options:')[0];
    if (iceOptions) {
      pc.canTrickleIceCandidates = iceOptions.substr(14).split(' ')
          .indexOf('trickle') >= 0;
    } else {
      pc.canTrickleIceCandidates = false;
    }

    sections.forEach(function(mediaSection, sdpMLineIndex) {
      var lines = SDPUtils.splitLines(mediaSection);
      var kind = SDPUtils.getKind(mediaSection);
      // treat bundle-only as not-rejected.
      var rejected = SDPUtils.isRejected(mediaSection) &&
          SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
      var protocol = lines[0].substr(2).split(' ')[2];

      var direction = SDPUtils.getDirection(mediaSection, sessionpart);
      var remoteMsid = SDPUtils.parseMsid(mediaSection);

      var mid = SDPUtils.getMid(mediaSection) || SDPUtils.generateIdentifier();

      // Reject datachannels which are not implemented yet.
      if ((kind === 'application' && protocol === 'DTLS/SCTP') || rejected) {
        // TODO: this is dangerous in the case where a non-rejected m-line
        //     becomes rejected.
        pc.transceivers[sdpMLineIndex] = {
          mid: mid,
          kind: kind,
          rejected: true
        };
        return;
      }

      if (!rejected && pc.transceivers[sdpMLineIndex] &&
          pc.transceivers[sdpMLineIndex].rejected) {
        // recycle a rejected transceiver.
        pc.transceivers[sdpMLineIndex] = pc._createTransceiver(kind, true);
      }

      var transceiver;
      var iceGatherer;
      var iceTransport;
      var dtlsTransport;
      var rtpReceiver;
      var sendEncodingParameters;
      var recvEncodingParameters;
      var localCapabilities;

      var track;
      // FIXME: ensure the mediaSection has rtcp-mux set.
      var remoteCapabilities = SDPUtils.parseRtpParameters(mediaSection);
      var remoteIceParameters;
      var remoteDtlsParameters;
      if (!rejected) {
        remoteIceParameters = SDPUtils.getIceParameters(mediaSection,
            sessionpart);
        remoteDtlsParameters = SDPUtils.getDtlsParameters(mediaSection,
            sessionpart);
        remoteDtlsParameters.role = 'client';
      }
      recvEncodingParameters =
          SDPUtils.parseRtpEncodingParameters(mediaSection);

      var rtcpParameters = SDPUtils.parseRtcpParameters(mediaSection);

      var isComplete = SDPUtils.matchPrefix(mediaSection,
          'a=end-of-candidates', sessionpart).length > 0;
      var cands = SDPUtils.matchPrefix(mediaSection, 'a=candidate:')
          .map(function(cand) {
            return SDPUtils.parseCandidate(cand);
          })
          .filter(function(cand) {
            return cand.component === 1;
          });

      // Check if we can use BUNDLE and dispose transports.
      if ((description.type === 'offer' || description.type === 'answer') &&
          !rejected && usingBundle && sdpMLineIndex > 0 &&
          pc.transceivers[sdpMLineIndex]) {
        pc._disposeIceAndDtlsTransports(sdpMLineIndex);
        pc.transceivers[sdpMLineIndex].iceGatherer =
            pc.transceivers[0].iceGatherer;
        pc.transceivers[sdpMLineIndex].iceTransport =
            pc.transceivers[0].iceTransport;
        pc.transceivers[sdpMLineIndex].dtlsTransport =
            pc.transceivers[0].dtlsTransport;
        if (pc.transceivers[sdpMLineIndex].rtpSender) {
          pc.transceivers[sdpMLineIndex].rtpSender.setTransport(
              pc.transceivers[0].dtlsTransport);
        }
        if (pc.transceivers[sdpMLineIndex].rtpReceiver) {
          pc.transceivers[sdpMLineIndex].rtpReceiver.setTransport(
              pc.transceivers[0].dtlsTransport);
        }
      }
      if (description.type === 'offer' && !rejected) {
        transceiver = pc.transceivers[sdpMLineIndex] ||
            pc._createTransceiver(kind);
        transceiver.mid = mid;

        if (!transceiver.iceGatherer) {
          transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
              usingBundle);
        }

        if (cands.length && transceiver.iceTransport.state === 'new') {
          if (isComplete && (!usingBundle || sdpMLineIndex === 0)) {
            transceiver.iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        localCapabilities = window.RTCRtpReceiver.getCapabilities(kind);

        // filter RTX until additional stuff needed for RTX is implemented
        // in adapter.js
        if (edgeVersion < 15019) {
          localCapabilities.codecs = localCapabilities.codecs.filter(
              function(codec) {
                return codec.name !== 'rtx';
              });
        }

        sendEncodingParameters = transceiver.sendEncodingParameters || [{
          ssrc: (2 * sdpMLineIndex + 2) * 1001
        }];

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        var isNewTrack = false;
        if (direction === 'sendrecv' || direction === 'sendonly') {
          isNewTrack = !transceiver.rtpReceiver;
          rtpReceiver = transceiver.rtpReceiver ||
              new window.RTCRtpReceiver(transceiver.dtlsTransport, kind);

          if (isNewTrack) {
            var stream;
            track = rtpReceiver.track;
            // FIXME: does not work with Plan B.
            if (remoteMsid && remoteMsid.stream === '-') {
              // no-op. a stream id of '-' means: no associated stream.
            } else if (remoteMsid) {
              if (!streams[remoteMsid.stream]) {
                streams[remoteMsid.stream] = new window.MediaStream();
                Object.defineProperty(streams[remoteMsid.stream], 'id', {
                  get: function() {
                    return remoteMsid.stream;
                  }
                });
              }
              Object.defineProperty(track, 'id', {
                get: function() {
                  return remoteMsid.track;
                }
              });
              stream = streams[remoteMsid.stream];
            } else {
              if (!streams.default) {
                streams.default = new window.MediaStream();
              }
              stream = streams.default;
            }
            if (stream) {
              addTrackToStreamAndFireEvent(track, stream);
              transceiver.associatedRemoteMediaStreams.push(stream);
            }
            receiverList.push([track, rtpReceiver, stream]);
          }
        } else if (transceiver.rtpReceiver && transceiver.rtpReceiver.track) {
          transceiver.associatedRemoteMediaStreams.forEach(function(s) {
            var nativeTrack = s.getTracks().find(function(t) {
              return t.id === transceiver.rtpReceiver.track.id;
            });
            if (nativeTrack) {
              removeTrackFromStreamAndFireEvent(nativeTrack, s);
            }
          });
          transceiver.associatedRemoteMediaStreams = [];
        }

        transceiver.localCapabilities = localCapabilities;
        transceiver.remoteCapabilities = remoteCapabilities;
        transceiver.rtpReceiver = rtpReceiver;
        transceiver.rtcpParameters = rtcpParameters;
        transceiver.sendEncodingParameters = sendEncodingParameters;
        transceiver.recvEncodingParameters = recvEncodingParameters;

        // Start the RTCRtpReceiver now. The RTPSender is started in
        // setLocalDescription.
        pc._transceive(pc.transceivers[sdpMLineIndex],
            false,
            isNewTrack);
      } else if (description.type === 'answer' && !rejected) {
        transceiver = pc.transceivers[sdpMLineIndex];
        iceGatherer = transceiver.iceGatherer;
        iceTransport = transceiver.iceTransport;
        dtlsTransport = transceiver.dtlsTransport;
        rtpReceiver = transceiver.rtpReceiver;
        sendEncodingParameters = transceiver.sendEncodingParameters;
        localCapabilities = transceiver.localCapabilities;

        pc.transceivers[sdpMLineIndex].recvEncodingParameters =
            recvEncodingParameters;
        pc.transceivers[sdpMLineIndex].remoteCapabilities =
            remoteCapabilities;
        pc.transceivers[sdpMLineIndex].rtcpParameters = rtcpParameters;

        if (cands.length && iceTransport.state === 'new') {
          if ((isIceLite || isComplete) &&
              (!usingBundle || sdpMLineIndex === 0)) {
            iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        if (!usingBundle || sdpMLineIndex === 0) {
          if (iceTransport.state === 'new') {
            iceTransport.start(iceGatherer, remoteIceParameters,
                'controlling');
          }
          if (dtlsTransport.state === 'new') {
            dtlsTransport.start(remoteDtlsParameters);
          }
        }

        pc._transceive(transceiver,
            direction === 'sendrecv' || direction === 'recvonly',
            direction === 'sendrecv' || direction === 'sendonly');

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        if (rtpReceiver &&
            (direction === 'sendrecv' || direction === 'sendonly')) {
          track = rtpReceiver.track;
          if (remoteMsid) {
            if (!streams[remoteMsid.stream]) {
              streams[remoteMsid.stream] = new window.MediaStream();
            }
            addTrackToStreamAndFireEvent(track, streams[remoteMsid.stream]);
            receiverList.push([track, rtpReceiver, streams[remoteMsid.stream]]);
          } else {
            if (!streams.default) {
              streams.default = new window.MediaStream();
            }
            addTrackToStreamAndFireEvent(track, streams.default);
            receiverList.push([track, rtpReceiver, streams.default]);
          }
        } else {
          // FIXME: actually the receiver should be created later.
          delete transceiver.rtpReceiver;
        }
      }
    });

    if (pc._dtlsRole === undefined) {
      pc._dtlsRole = description.type === 'offer' ? 'active' : 'passive';
    }

    pc.remoteDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-remote-offer');
    } else {
      pc._updateSignalingState('stable');
    }
    Object.keys(streams).forEach(function(sid) {
      var stream = streams[sid];
      if (stream.getTracks().length) {
        if (pc.remoteStreams.indexOf(stream) === -1) {
          pc.remoteStreams.push(stream);
          var event = new Event('addstream');
          event.stream = stream;
          window.setTimeout(function() {
            pc._dispatchEvent('addstream', event);
          });
        }

        receiverList.forEach(function(item) {
          var track = item[0];
          var receiver = item[1];
          if (stream.id !== item[2].id) {
            return;
          }
          fireAddTrack(pc, track, receiver, [stream]);
        });
      }
    });
    receiverList.forEach(function(item) {
      if (item[2]) {
        return;
      }
      fireAddTrack(pc, item[0], item[1], []);
    });

    // check whether addIceCandidate({}) was called within four seconds after
    // setRemoteDescription.
    window.setTimeout(function() {
      if (!(pc && pc.transceivers)) {
        return;
      }
      pc.transceivers.forEach(function(transceiver) {
        if (transceiver.iceTransport &&
            transceiver.iceTransport.state === 'new' &&
            transceiver.iceTransport.getRemoteCandidates().length > 0) {
          console.warn('Timeout for addRemoteCandidate. Consider sending ' +
              'an end-of-candidates notification');
          transceiver.iceTransport.addRemoteCandidate({});
        }
      });
    }, 4000);

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.close = function() {
    this.transceivers.forEach(function(transceiver) {
      /* not yet
      if (transceiver.iceGatherer) {
        transceiver.iceGatherer.close();
      }
      */
      if (transceiver.iceTransport) {
        transceiver.iceTransport.stop();
      }
      if (transceiver.dtlsTransport) {
        transceiver.dtlsTransport.stop();
      }
      if (transceiver.rtpSender) {
        transceiver.rtpSender.stop();
      }
      if (transceiver.rtpReceiver) {
        transceiver.rtpReceiver.stop();
      }
    });
    // FIXME: clean up tracks, local streams, remote streams, etc
    this._isClosed = true;
    this._updateSignalingState('closed');
  };

  // Update the signaling state.
  RTCPeerConnection.prototype._updateSignalingState = function(newState) {
    this.signalingState = newState;
    var event = new Event('signalingstatechange');
    this._dispatchEvent('signalingstatechange', event);
  };

  // Determine whether to fire the negotiationneeded event.
  RTCPeerConnection.prototype._maybeFireNegotiationNeeded = function() {
    var pc = this;
    if (this.signalingState !== 'stable' || this.needNegotiation === true) {
      return;
    }
    this.needNegotiation = true;
    window.setTimeout(function() {
      if (pc.needNegotiation) {
        pc.needNegotiation = false;
        var event = new Event('negotiationneeded');
        pc._dispatchEvent('negotiationneeded', event);
      }
    }, 0);
  };

  // Update the ice connection state.
  RTCPeerConnection.prototype._updateIceConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      checking: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this.transceivers.forEach(function(transceiver) {
      states[transceiver.iceTransport.state]++;
    });

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.checking > 0) {
      newState = 'checking';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    } else if (states.completed > 0) {
      newState = 'completed';
    }

    if (newState !== this.iceConnectionState) {
      this.iceConnectionState = newState;
      var event = new Event('iceconnectionstatechange');
      this._dispatchEvent('iceconnectionstatechange', event);
    }
  };

  // Update the connection state.
  RTCPeerConnection.prototype._updateConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      connecting: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this.transceivers.forEach(function(transceiver) {
      states[transceiver.iceTransport.state]++;
      states[transceiver.dtlsTransport.state]++;
    });
    // ICETransport.completed and connected are the same for this purpose.
    states.connected += states.completed;

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.connecting > 0) {
      newState = 'connecting';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    }

    if (newState !== this.connectionState) {
      this.connectionState = newState;
      var event = new Event('connectionstatechange');
      this._dispatchEvent('connectionstatechange', event);
    }
  };

  RTCPeerConnection.prototype.createOffer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createOffer after close'));
    }

    var numAudioTracks = pc.transceivers.filter(function(t) {
      return t.kind === 'audio';
    }).length;
    var numVideoTracks = pc.transceivers.filter(function(t) {
      return t.kind === 'video';
    }).length;

    // Determine number of audio and video tracks we need to send/recv.
    var offerOptions = arguments[0];
    if (offerOptions) {
      // Reject Chrome legacy constraints.
      if (offerOptions.mandatory || offerOptions.optional) {
        throw new TypeError(
            'Legacy mandatory/optional constraints not supported.');
      }
      if (offerOptions.offerToReceiveAudio !== undefined) {
        if (offerOptions.offerToReceiveAudio === true) {
          numAudioTracks = 1;
        } else if (offerOptions.offerToReceiveAudio === false) {
          numAudioTracks = 0;
        } else {
          numAudioTracks = offerOptions.offerToReceiveAudio;
        }
      }
      if (offerOptions.offerToReceiveVideo !== undefined) {
        if (offerOptions.offerToReceiveVideo === true) {
          numVideoTracks = 1;
        } else if (offerOptions.offerToReceiveVideo === false) {
          numVideoTracks = 0;
        } else {
          numVideoTracks = offerOptions.offerToReceiveVideo;
        }
      }
    }

    pc.transceivers.forEach(function(transceiver) {
      if (transceiver.kind === 'audio') {
        numAudioTracks--;
        if (numAudioTracks < 0) {
          transceiver.wantReceive = false;
        }
      } else if (transceiver.kind === 'video') {
        numVideoTracks--;
        if (numVideoTracks < 0) {
          transceiver.wantReceive = false;
        }
      }
    });

    // Create M-lines for recvonly streams.
    while (numAudioTracks > 0 || numVideoTracks > 0) {
      if (numAudioTracks > 0) {
        pc._createTransceiver('audio');
        numAudioTracks--;
      }
      if (numVideoTracks > 0) {
        pc._createTransceiver('video');
        numVideoTracks--;
      }
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
        pc._sdpSessionVersion++);
    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      // For each track, create an ice gatherer, ice transport,
      // dtls transport, potentially rtpsender and rtpreceiver.
      var track = transceiver.track;
      var kind = transceiver.kind;
      var mid = transceiver.mid || SDPUtils.generateIdentifier();
      transceiver.mid = mid;

      if (!transceiver.iceGatherer) {
        transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
            pc.usingBundle);
      }

      var localCapabilities = window.RTCRtpSender.getCapabilities(kind);
      // filter RTX until additional stuff needed for RTX is implemented
      // in adapter.js
      if (edgeVersion < 15019) {
        localCapabilities.codecs = localCapabilities.codecs.filter(
            function(codec) {
              return codec.name !== 'rtx';
            });
      }
      localCapabilities.codecs.forEach(function(codec) {
        // work around https://bugs.chromium.org/p/webrtc/issues/detail?id=6552
        // by adding level-asymmetry-allowed=1
        if (codec.name === 'H264' &&
            codec.parameters['level-asymmetry-allowed'] === undefined) {
          codec.parameters['level-asymmetry-allowed'] = '1';
        }

        // for subsequent offers, we might have to re-use the payload
        // type of the last offer.
        if (transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.codecs) {
          transceiver.remoteCapabilities.codecs.forEach(function(remoteCodec) {
            if (codec.name.toLowerCase() === remoteCodec.name.toLowerCase() &&
                codec.clockRate === remoteCodec.clockRate) {
              codec.preferredPayloadType = remoteCodec.payloadType;
            }
          });
        }
      });
      localCapabilities.headerExtensions.forEach(function(hdrExt) {
        var remoteExtensions = transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.headerExtensions || [];
        remoteExtensions.forEach(function(rHdrExt) {
          if (hdrExt.uri === rHdrExt.uri) {
            hdrExt.id = rHdrExt.id;
          }
        });
      });

      // generate an ssrc now, to be used later in rtpSender.send
      var sendEncodingParameters = transceiver.sendEncodingParameters || [{
        ssrc: (2 * sdpMLineIndex + 1) * 1001
      }];
      if (track) {
        // add RTX
        if (edgeVersion >= 15019 && kind === 'video' &&
            !sendEncodingParameters[0].rtx) {
          sendEncodingParameters[0].rtx = {
            ssrc: sendEncodingParameters[0].ssrc + 1
          };
        }
      }

      if (transceiver.wantReceive) {
        transceiver.rtpReceiver = new window.RTCRtpReceiver(
            transceiver.dtlsTransport, kind);
      }

      transceiver.localCapabilities = localCapabilities;
      transceiver.sendEncodingParameters = sendEncodingParameters;
    });

    // always offer BUNDLE and dispose on return if not supported.
    if (pc._config.bundlePolicy !== 'max-compat') {
      sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    sdp += 'a=ice-options:trickle\r\n';

    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      sdp += writeMediaSection(transceiver, transceiver.localCapabilities,
          'offer', transceiver.stream, pc._dtlsRole);
      sdp += 'a=rtcp-rsize\r\n';

      if (transceiver.iceGatherer && pc.iceGatheringState !== 'new' &&
          (sdpMLineIndex === 0 || !pc.usingBundle)) {
        transceiver.iceGatherer.getLocalCandidates().forEach(function(cand) {
          cand.component = 1;
          sdp += 'a=' + SDPUtils.writeCandidate(cand) + '\r\n';
        });

        if (transceiver.iceGatherer.state === 'completed') {
          sdp += 'a=end-of-candidates\r\n';
        }
      }
    });

    var desc = new window.RTCSessionDescription({
      type: 'offer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.createAnswer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createAnswer after close'));
    }

    if (!(pc.signalingState === 'have-remote-offer' ||
        pc.signalingState === 'have-local-pranswer')) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createAnswer in signalingState ' + pc.signalingState));
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
        pc._sdpSessionVersion++);
    if (pc.usingBundle) {
      sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    var mediaSectionsInOffer = SDPUtils.getMediaSections(
        pc.remoteDescription.sdp).length;
    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      if (sdpMLineIndex + 1 > mediaSectionsInOffer) {
        return;
      }
      if (transceiver.rejected) {
        if (transceiver.kind === 'application') {
          sdp += 'm=application 0 DTLS/SCTP 5000\r\n';
        } else if (transceiver.kind === 'audio') {
          sdp += 'm=audio 0 UDP/TLS/RTP/SAVPF 0\r\n' +
              'a=rtpmap:0 PCMU/8000\r\n';
        } else if (transceiver.kind === 'video') {
          sdp += 'm=video 0 UDP/TLS/RTP/SAVPF 120\r\n' +
              'a=rtpmap:120 VP8/90000\r\n';
        }
        sdp += 'c=IN IP4 0.0.0.0\r\n' +
            'a=inactive\r\n' +
            'a=mid:' + transceiver.mid + '\r\n';
        return;
      }

      // FIXME: look at direction.
      if (transceiver.stream) {
        var localTrack;
        if (transceiver.kind === 'audio') {
          localTrack = transceiver.stream.getAudioTracks()[0];
        } else if (transceiver.kind === 'video') {
          localTrack = transceiver.stream.getVideoTracks()[0];
        }
        if (localTrack) {
          // add RTX
          if (edgeVersion >= 15019 && transceiver.kind === 'video' &&
              !transceiver.sendEncodingParameters[0].rtx) {
            transceiver.sendEncodingParameters[0].rtx = {
              ssrc: transceiver.sendEncodingParameters[0].ssrc + 1
            };
          }
        }
      }

      // Calculate intersection of capabilities.
      var commonCapabilities = getCommonCapabilities(
          transceiver.localCapabilities,
          transceiver.remoteCapabilities);

      var hasRtx = commonCapabilities.codecs.filter(function(c) {
        return c.name.toLowerCase() === 'rtx';
      }).length;
      if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
        delete transceiver.sendEncodingParameters[0].rtx;
      }

      sdp += writeMediaSection(transceiver, commonCapabilities,
          'answer', transceiver.stream, pc._dtlsRole);
      if (transceiver.rtcpParameters &&
          transceiver.rtcpParameters.reducedSize) {
        sdp += 'a=rtcp-rsize\r\n';
      }
    });

    var desc = new window.RTCSessionDescription({
      type: 'answer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
    var pc = this;
    var sections;
    if (candidate && !(candidate.sdpMLineIndex !== undefined ||
        candidate.sdpMid)) {
      return Promise.reject(new TypeError('sdpMLineIndex or sdpMid required'));
    }

    // TODO: needs to go into ops queue.
    return new Promise(function(resolve, reject) {
      if (!pc.remoteDescription) {
        return reject(makeError('InvalidStateError',
            'Can not add ICE candidate without a remote description'));
      } else if (!candidate || candidate.candidate === '') {
        for (var j = 0; j < pc.transceivers.length; j++) {
          if (pc.transceivers[j].rejected) {
            continue;
          }
          pc.transceivers[j].iceTransport.addRemoteCandidate({});
          sections = SDPUtils.getMediaSections(pc.remoteDescription.sdp);
          sections[j] += 'a=end-of-candidates\r\n';
          pc.remoteDescription.sdp =
              SDPUtils.getDescription(pc.remoteDescription.sdp) +
              sections.join('');
          if (pc.usingBundle) {
            break;
          }
        }
      } else {
        var sdpMLineIndex = candidate.sdpMLineIndex;
        if (candidate.sdpMid) {
          for (var i = 0; i < pc.transceivers.length; i++) {
            if (pc.transceivers[i].mid === candidate.sdpMid) {
              sdpMLineIndex = i;
              break;
            }
          }
        }
        var transceiver = pc.transceivers[sdpMLineIndex];
        if (transceiver) {
          if (transceiver.rejected) {
            return resolve();
          }
          var cand = Object.keys(candidate.candidate).length > 0 ?
              SDPUtils.parseCandidate(candidate.candidate) : {};
          // Ignore Chrome's invalid candidates since Edge does not like them.
          if (cand.protocol === 'tcp' && (cand.port === 0 || cand.port === 9)) {
            return resolve();
          }
          // Ignore RTCP candidates, we assume RTCP-MUX.
          if (cand.component && cand.component !== 1) {
            return resolve();
          }
          // when using bundle, avoid adding candidates to the wrong
          // ice transport. And avoid adding candidates added in the SDP.
          if (sdpMLineIndex === 0 || (sdpMLineIndex > 0 &&
              transceiver.iceTransport !== pc.transceivers[0].iceTransport)) {
            if (!maybeAddCandidate(transceiver.iceTransport, cand)) {
              return reject(makeError('OperationError',
                  'Can not add ICE candidate'));
            }
          }

          // update the remoteDescription.
          var candidateString = candidate.candidate.trim();
          if (candidateString.indexOf('a=') === 0) {
            candidateString = candidateString.substr(2);
          }
          sections = SDPUtils.getMediaSections(pc.remoteDescription.sdp);
          sections[sdpMLineIndex] += 'a=' +
              (cand.type ? candidateString : 'end-of-candidates')
              + '\r\n';
          pc.remoteDescription.sdp =
              SDPUtils.getDescription(pc.remoteDescription.sdp) +
              sections.join('');
        } else {
          return reject(makeError('OperationError',
              'Can not add ICE candidate'));
        }
      }
      resolve();
    });
  };

  RTCPeerConnection.prototype.getStats = function() {
    var promises = [];
    this.transceivers.forEach(function(transceiver) {
      ['rtpSender', 'rtpReceiver', 'iceGatherer', 'iceTransport',
          'dtlsTransport'].forEach(function(method) {
            if (transceiver[method]) {
              promises.push(transceiver[method].getStats());
            }
          });
    });
    var fixStatsType = function(stat) {
      return {
        inboundrtp: 'inbound-rtp',
        outboundrtp: 'outbound-rtp',
        candidatepair: 'candidate-pair',
        localcandidate: 'local-candidate',
        remotecandidate: 'remote-candidate'
      }[stat.type] || stat.type;
    };
    return new Promise(function(resolve) {
      // shim getStats with maplike support
      var results = new Map();
      Promise.all(promises).then(function(res) {
        res.forEach(function(result) {
          Object.keys(result).forEach(function(id) {
            result[id].type = fixStatsType(result[id]);
            results.set(id, result[id]);
          });
        });
        resolve(results);
      });
    });
  };

  // legacy callback shims. Should be moved to adapter.js some days.
  var methods = ['createOffer', 'createAnswer'];
  methods.forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[0] === 'function' ||
          typeof args[1] === 'function') { // legacy
        return nativeMethod.apply(this, [arguments[2]])
        .then(function(description) {
          if (typeof args[0] === 'function') {
            args[0].apply(null, [description]);
          }
        }, function(error) {
          if (typeof args[1] === 'function') {
            args[1].apply(null, [error]);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  methods = ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate'];
  methods.forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[1] === 'function' ||
          typeof args[2] === 'function') { // legacy
        return nativeMethod.apply(this, arguments)
        .then(function() {
          if (typeof args[1] === 'function') {
            args[1].apply(null);
          }
        }, function(error) {
          if (typeof args[2] === 'function') {
            args[2].apply(null, [error]);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  // getStats is special. It doesn't have a spec legacy method yet we support
  // getStats(something, cb) without error callbacks.
  ['getStats'].forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[1] === 'function') {
        return nativeMethod.apply(this, arguments)
        .then(function() {
          if (typeof args[1] === 'function') {
            args[1].apply(null);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  return RTCPeerConnection;
};

},{"sdp":43}],43:[function(require,module,exports){
 /* eslint-env node */
'use strict';

// SDP helpers.
var SDPUtils = {};

// Generate an alphanumeric identifier for cname or mids.
// TODO: use UUIDs instead? https://gist.github.com/jed/982883
SDPUtils.generateIdentifier = function() {
  return Math.random().toString(36).substr(2, 10);
};

// The RTCP CNAME used by all peerconnections from the same JS.
SDPUtils.localCName = SDPUtils.generateIdentifier();

// Splits SDP into lines, dealing with both CRLF and LF.
SDPUtils.splitLines = function(blob) {
  return blob.trim().split('\n').map(function(line) {
    return line.trim();
  });
};
// Splits SDP into sessionpart and mediasections. Ensures CRLF.
SDPUtils.splitSections = function(blob) {
  var parts = blob.split('\nm=');
  return parts.map(function(part, index) {
    return (index > 0 ? 'm=' + part : part).trim() + '\r\n';
  });
};

// returns the session description.
SDPUtils.getDescription = function(blob) {
  var sections = SDPUtils.splitSections(blob);
  return sections && sections[0];
};

// returns the individual media sections.
SDPUtils.getMediaSections = function(blob) {
  var sections = SDPUtils.splitSections(blob);
  sections.shift();
  return sections;
};

// Returns lines that start with a certain prefix.
SDPUtils.matchPrefix = function(blob, prefix) {
  return SDPUtils.splitLines(blob).filter(function(line) {
    return line.indexOf(prefix) === 0;
  });
};

// Parses an ICE candidate line. Sample input:
// candidate:702786350 2 udp 41819902 8.8.8.8 60769 typ relay raddr 8.8.8.8
// rport 55996"
SDPUtils.parseCandidate = function(line) {
  var parts;
  // Parse both variants.
  if (line.indexOf('a=candidate:') === 0) {
    parts = line.substring(12).split(' ');
  } else {
    parts = line.substring(10).split(' ');
  }

  var candidate = {
    foundation: parts[0],
    component: parseInt(parts[1], 10),
    protocol: parts[2].toLowerCase(),
    priority: parseInt(parts[3], 10),
    ip: parts[4],
    port: parseInt(parts[5], 10),
    // skip parts[6] == 'typ'
    type: parts[7]
  };

  for (var i = 8; i < parts.length; i += 2) {
    switch (parts[i]) {
      case 'raddr':
        candidate.relatedAddress = parts[i + 1];
        break;
      case 'rport':
        candidate.relatedPort = parseInt(parts[i + 1], 10);
        break;
      case 'tcptype':
        candidate.tcpType = parts[i + 1];
        break;
      case 'ufrag':
        candidate.ufrag = parts[i + 1]; // for backward compability.
        candidate.usernameFragment = parts[i + 1];
        break;
      default: // extension handling, in particular ufrag
        candidate[parts[i]] = parts[i + 1];
        break;
    }
  }
  return candidate;
};

// Translates a candidate object into SDP candidate attribute.
SDPUtils.writeCandidate = function(candidate) {
  var sdp = [];
  sdp.push(candidate.foundation);
  sdp.push(candidate.component);
  sdp.push(candidate.protocol.toUpperCase());
  sdp.push(candidate.priority);
  sdp.push(candidate.ip);
  sdp.push(candidate.port);

  var type = candidate.type;
  sdp.push('typ');
  sdp.push(type);
  if (type !== 'host' && candidate.relatedAddress &&
      candidate.relatedPort) {
    sdp.push('raddr');
    sdp.push(candidate.relatedAddress); // was: relAddr
    sdp.push('rport');
    sdp.push(candidate.relatedPort); // was: relPort
  }
  if (candidate.tcpType && candidate.protocol.toLowerCase() === 'tcp') {
    sdp.push('tcptype');
    sdp.push(candidate.tcpType);
  }
  if (candidate.usernameFragment || candidate.ufrag) {
    sdp.push('ufrag');
    sdp.push(candidate.usernameFragment || candidate.ufrag);
  }
  return 'candidate:' + sdp.join(' ');
};

// Parses an ice-options line, returns an array of option tags.
// a=ice-options:foo bar
SDPUtils.parseIceOptions = function(line) {
  return line.substr(14).split(' ');
}

// Parses an rtpmap line, returns RTCRtpCoddecParameters. Sample input:
// a=rtpmap:111 opus/48000/2
SDPUtils.parseRtpMap = function(line) {
  var parts = line.substr(9).split(' ');
  var parsed = {
    payloadType: parseInt(parts.shift(), 10) // was: id
  };

  parts = parts[0].split('/');

  parsed.name = parts[0];
  parsed.clockRate = parseInt(parts[1], 10); // was: clockrate
  // was: channels
  parsed.numChannels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
  return parsed;
};

// Generate an a=rtpmap line from RTCRtpCodecCapability or
// RTCRtpCodecParameters.
SDPUtils.writeRtpMap = function(codec) {
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  return 'a=rtpmap:' + pt + ' ' + codec.name + '/' + codec.clockRate +
      (codec.numChannels !== 1 ? '/' + codec.numChannels : '') + '\r\n';
};

// Parses an a=extmap line (headerextension from RFC 5285). Sample input:
// a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
// a=extmap:2/sendonly urn:ietf:params:rtp-hdrext:toffset
SDPUtils.parseExtmap = function(line) {
  var parts = line.substr(9).split(' ');
  return {
    id: parseInt(parts[0], 10),
    direction: parts[0].indexOf('/') > 0 ? parts[0].split('/')[1] : 'sendrecv',
    uri: parts[1]
  };
};

// Generates a=extmap line from RTCRtpHeaderExtensionParameters or
// RTCRtpHeaderExtension.
SDPUtils.writeExtmap = function(headerExtension) {
  return 'a=extmap:' + (headerExtension.id || headerExtension.preferredId) +
      (headerExtension.direction && headerExtension.direction !== 'sendrecv'
          ? '/' + headerExtension.direction
          : '') +
      ' ' + headerExtension.uri + '\r\n';
};

// Parses an ftmp line, returns dictionary. Sample input:
// a=fmtp:96 vbr=on;cng=on
// Also deals with vbr=on; cng=on
SDPUtils.parseFmtp = function(line) {
  var parsed = {};
  var kv;
  var parts = line.substr(line.indexOf(' ') + 1).split(';');
  for (var j = 0; j < parts.length; j++) {
    kv = parts[j].trim().split('=');
    parsed[kv[0].trim()] = kv[1];
  }
  return parsed;
};

// Generates an a=ftmp line from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeFmtp = function(codec) {
  var line = '';
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.parameters && Object.keys(codec.parameters).length) {
    var params = [];
    Object.keys(codec.parameters).forEach(function(param) {
      params.push(param + '=' + codec.parameters[param]);
    });
    line += 'a=fmtp:' + pt + ' ' + params.join(';') + '\r\n';
  }
  return line;
};

// Parses an rtcp-fb line, returns RTCPRtcpFeedback object. Sample input:
// a=rtcp-fb:98 nack rpsi
SDPUtils.parseRtcpFb = function(line) {
  var parts = line.substr(line.indexOf(' ') + 1).split(' ');
  return {
    type: parts.shift(),
    parameter: parts.join(' ')
  };
};
// Generate a=rtcp-fb lines from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeRtcpFb = function(codec) {
  var lines = '';
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
    // FIXME: special handling for trr-int?
    codec.rtcpFeedback.forEach(function(fb) {
      lines += 'a=rtcp-fb:' + pt + ' ' + fb.type +
      (fb.parameter && fb.parameter.length ? ' ' + fb.parameter : '') +
          '\r\n';
    });
  }
  return lines;
};

// Parses an RFC 5576 ssrc media attribute. Sample input:
// a=ssrc:3735928559 cname:something
SDPUtils.parseSsrcMedia = function(line) {
  var sp = line.indexOf(' ');
  var parts = {
    ssrc: parseInt(line.substr(7, sp - 7), 10)
  };
  var colon = line.indexOf(':', sp);
  if (colon > -1) {
    parts.attribute = line.substr(sp + 1, colon - sp - 1);
    parts.value = line.substr(colon + 1);
  } else {
    parts.attribute = line.substr(sp + 1);
  }
  return parts;
};

// Extracts the MID (RFC 5888) from a media section.
// returns the MID or undefined if no mid line was found.
SDPUtils.getMid = function(mediaSection) {
  var mid = SDPUtils.matchPrefix(mediaSection, 'a=mid:')[0];
  if (mid) {
    return mid.substr(6);
  }
}

SDPUtils.parseFingerprint = function(line) {
  var parts = line.substr(14).split(' ');
  return {
    algorithm: parts[0].toLowerCase(), // algorithm is case-sensitive in Edge.
    value: parts[1]
  };
};

// Extracts DTLS parameters from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the fingerprint line as input. See also getIceParameters.
SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
  var lines = SDPUtils.matchPrefix(mediaSection + sessionpart,
      'a=fingerprint:');
  // Note: a=setup line is ignored since we use the 'auto' role.
  // Note2: 'algorithm' is not case sensitive except in Edge.
  return {
    role: 'auto',
    fingerprints: lines.map(SDPUtils.parseFingerprint)
  };
};

// Serializes DTLS parameters to SDP.
SDPUtils.writeDtlsParameters = function(params, setupType) {
  var sdp = 'a=setup:' + setupType + '\r\n';
  params.fingerprints.forEach(function(fp) {
    sdp += 'a=fingerprint:' + fp.algorithm + ' ' + fp.value + '\r\n';
  });
  return sdp;
};
// Parses ICE information from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the ice-ufrag and ice-pwd lines as input.
SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
  var lines = SDPUtils.splitLines(mediaSection);
  // Search in session part, too.
  lines = lines.concat(SDPUtils.splitLines(sessionpart));
  var iceParameters = {
    usernameFragment: lines.filter(function(line) {
      return line.indexOf('a=ice-ufrag:') === 0;
    })[0].substr(12),
    password: lines.filter(function(line) {
      return line.indexOf('a=ice-pwd:') === 0;
    })[0].substr(10)
  };
  return iceParameters;
};

// Serializes ICE parameters to SDP.
SDPUtils.writeIceParameters = function(params) {
  return 'a=ice-ufrag:' + params.usernameFragment + '\r\n' +
      'a=ice-pwd:' + params.password + '\r\n';
};

// Parses the SDP media section and returns RTCRtpParameters.
SDPUtils.parseRtpParameters = function(mediaSection) {
  var description = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: [],
    rtcp: []
  };
  var lines = SDPUtils.splitLines(mediaSection);
  var mline = lines[0].split(' ');
  for (var i = 3; i < mline.length; i++) { // find all codecs from mline[3..]
    var pt = mline[i];
    var rtpmapline = SDPUtils.matchPrefix(
        mediaSection, 'a=rtpmap:' + pt + ' ')[0];
    if (rtpmapline) {
      var codec = SDPUtils.parseRtpMap(rtpmapline);
      var fmtps = SDPUtils.matchPrefix(
          mediaSection, 'a=fmtp:' + pt + ' ');
      // Only the first a=fmtp:<pt> is considered.
      codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
      codec.rtcpFeedback = SDPUtils.matchPrefix(
          mediaSection, 'a=rtcp-fb:' + pt + ' ')
        .map(SDPUtils.parseRtcpFb);
      description.codecs.push(codec);
      // parse FEC mechanisms from rtpmap lines.
      switch (codec.name.toUpperCase()) {
        case 'RED':
        case 'ULPFEC':
          description.fecMechanisms.push(codec.name.toUpperCase());
          break;
        default: // only RED and ULPFEC are recognized as FEC mechanisms.
          break;
      }
    }
  }
  SDPUtils.matchPrefix(mediaSection, 'a=extmap:').forEach(function(line) {
    description.headerExtensions.push(SDPUtils.parseExtmap(line));
  });
  // FIXME: parse rtcp.
  return description;
};

// Generates parts of the SDP media section describing the capabilities /
// parameters.
SDPUtils.writeRtpDescription = function(kind, caps) {
  var sdp = '';

  // Build the mline.
  sdp += 'm=' + kind + ' ';
  sdp += caps.codecs.length > 0 ? '9' : '0'; // reject if no codecs.
  sdp += ' UDP/TLS/RTP/SAVPF ';
  sdp += caps.codecs.map(function(codec) {
    if (codec.preferredPayloadType !== undefined) {
      return codec.preferredPayloadType;
    }
    return codec.payloadType;
  }).join(' ') + '\r\n';

  sdp += 'c=IN IP4 0.0.0.0\r\n';
  sdp += 'a=rtcp:9 IN IP4 0.0.0.0\r\n';

  // Add a=rtpmap lines for each codec. Also fmtp and rtcp-fb.
  caps.codecs.forEach(function(codec) {
    sdp += SDPUtils.writeRtpMap(codec);
    sdp += SDPUtils.writeFmtp(codec);
    sdp += SDPUtils.writeRtcpFb(codec);
  });
  var maxptime = 0;
  caps.codecs.forEach(function(codec) {
    if (codec.maxptime > maxptime) {
      maxptime = codec.maxptime;
    }
  });
  if (maxptime > 0) {
    sdp += 'a=maxptime:' + maxptime + '\r\n';
  }
  sdp += 'a=rtcp-mux\r\n';

  caps.headerExtensions.forEach(function(extension) {
    sdp += SDPUtils.writeExtmap(extension);
  });
  // FIXME: write fecMechanisms.
  return sdp;
};

// Parses the SDP media section and returns an array of
// RTCRtpEncodingParameters.
SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
  var encodingParameters = [];
  var description = SDPUtils.parseRtpParameters(mediaSection);
  var hasRed = description.fecMechanisms.indexOf('RED') !== -1;
  var hasUlpfec = description.fecMechanisms.indexOf('ULPFEC') !== -1;

  // filter a=ssrc:... cname:, ignore PlanB-msid
  var ssrcs = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
  .map(function(line) {
    return SDPUtils.parseSsrcMedia(line);
  })
  .filter(function(parts) {
    return parts.attribute === 'cname';
  });
  var primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
  var secondarySsrc;

  var flows = SDPUtils.matchPrefix(mediaSection, 'a=ssrc-group:FID')
  .map(function(line) {
    var parts = line.split(' ');
    parts.shift();
    return parts.map(function(part) {
      return parseInt(part, 10);
    });
  });
  if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
    secondarySsrc = flows[0][1];
  }

  description.codecs.forEach(function(codec) {
    if (codec.name.toUpperCase() === 'RTX' && codec.parameters.apt) {
      var encParam = {
        ssrc: primarySsrc,
        codecPayloadType: parseInt(codec.parameters.apt, 10),
        rtx: {
          ssrc: secondarySsrc
        }
      };
      encodingParameters.push(encParam);
      if (hasRed) {
        encParam = JSON.parse(JSON.stringify(encParam));
        encParam.fec = {
          ssrc: secondarySsrc,
          mechanism: hasUlpfec ? 'red+ulpfec' : 'red'
        };
        encodingParameters.push(encParam);
      }
    }
  });
  if (encodingParameters.length === 0 && primarySsrc) {
    encodingParameters.push({
      ssrc: primarySsrc
    });
  }

  // we support both b=AS and b=TIAS but interpret AS as TIAS.
  var bandwidth = SDPUtils.matchPrefix(mediaSection, 'b=');
  if (bandwidth.length) {
    if (bandwidth[0].indexOf('b=TIAS:') === 0) {
      bandwidth = parseInt(bandwidth[0].substr(7), 10);
    } else if (bandwidth[0].indexOf('b=AS:') === 0) {
      // use formula from JSEP to convert b=AS to TIAS value.
      bandwidth = parseInt(bandwidth[0].substr(5), 10) * 1000 * 0.95
          - (50 * 40 * 8);
    } else {
      bandwidth = undefined;
    }
    encodingParameters.forEach(function(params) {
      params.maxBitrate = bandwidth;
    });
  }
  return encodingParameters;
};

// parses http://draft.ortc.org/#rtcrtcpparameters*
SDPUtils.parseRtcpParameters = function(mediaSection) {
  var rtcpParameters = {};

  var cname;
  // Gets the first SSRC. Note that with RTX there might be multiple
  // SSRCs.
  var remoteSsrc = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
      .map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
      })
      .filter(function(obj) {
        return obj.attribute === 'cname';
      })[0];
  if (remoteSsrc) {
    rtcpParameters.cname = remoteSsrc.value;
    rtcpParameters.ssrc = remoteSsrc.ssrc;
  }

  // Edge uses the compound attribute instead of reducedSize
  // compound is !reducedSize
  var rsize = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-rsize');
  rtcpParameters.reducedSize = rsize.length > 0;
  rtcpParameters.compound = rsize.length === 0;

  // parses the rtcp-mux attrіbute.
  // Note that Edge does not support unmuxed RTCP.
  var mux = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-mux');
  rtcpParameters.mux = mux.length > 0;

  return rtcpParameters;
};

// parses either a=msid: or a=ssrc:... msid lines and returns
// the id of the MediaStream and MediaStreamTrack.
SDPUtils.parseMsid = function(mediaSection) {
  var parts;
  var spec = SDPUtils.matchPrefix(mediaSection, 'a=msid:');
  if (spec.length === 1) {
    parts = spec[0].substr(7).split(' ');
    return {stream: parts[0], track: parts[1]};
  }
  var planB = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
  .map(function(line) {
    return SDPUtils.parseSsrcMedia(line);
  })
  .filter(function(parts) {
    return parts.attribute === 'msid';
  });
  if (planB.length > 0) {
    parts = planB[0].value.split(' ');
    return {stream: parts[0], track: parts[1]};
  }
};

// Generate a session ID for SDP.
// https://tools.ietf.org/html/draft-ietf-rtcweb-jsep-20#section-5.2.1
// recommends using a cryptographically random +ve 64-bit value
// but right now this should be acceptable and within the right range
SDPUtils.generateSessionId = function() {
  return Math.random().toString().substr(2, 21);
};

// Write boilder plate for start of SDP
// sessId argument is optional - if not supplied it will
// be generated randomly
// sessVersion is optional and defaults to 2
SDPUtils.writeSessionBoilerplate = function(sessId, sessVer) {
  var sessionId;
  var version = sessVer !== undefined ? sessVer : 2;
  if (sessId) {
    sessionId = sessId;
  } else {
    sessionId = SDPUtils.generateSessionId();
  }
  // FIXME: sess-id should be an NTP timestamp.
  return 'v=0\r\n' +
      'o=thisisadapterortc ' + sessionId + ' ' + version + ' IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n';
};

SDPUtils.writeMediaSection = function(transceiver, caps, type, stream) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
      transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
      transceiver.dtlsTransport.getLocalParameters(),
      type === 'offer' ? 'actpass' : 'active');

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.direction) {
    sdp += 'a=' + transceiver.direction + '\r\n';
  } else if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    // spec.
    var msid = 'msid:' + stream.id + ' ' +
        transceiver.rtpSender.track.id + '\r\n';
    sdp += 'a=' + msid;

    // for Chrome.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
};

// Gets the direction from the mediaSection or the sessionpart.
SDPUtils.getDirection = function(mediaSection, sessionpart) {
  // Look for sendrecv, sendonly, recvonly, inactive, default to sendrecv.
  var lines = SDPUtils.splitLines(mediaSection);
  for (var i = 0; i < lines.length; i++) {
    switch (lines[i]) {
      case 'a=sendrecv':
      case 'a=sendonly':
      case 'a=recvonly':
      case 'a=inactive':
        return lines[i].substr(2);
      default:
        // FIXME: What should happen here?
    }
  }
  if (sessionpart) {
    return SDPUtils.getDirection(sessionpart);
  }
  return 'sendrecv';
};

SDPUtils.getKind = function(mediaSection) {
  var lines = SDPUtils.splitLines(mediaSection);
  var mline = lines[0].split(' ');
  return mline[0].substr(2);
};

SDPUtils.isRejected = function(mediaSection) {
  return mediaSection.split(' ', 2)[1] === '0';
};

SDPUtils.parseMLine = function(mediaSection) {
  var lines = SDPUtils.splitLines(mediaSection);
  var parts = lines[0].substr(2).split(' ');
  return {
    kind: parts[0],
    port: parseInt(parts[1], 10),
    protocol: parts[2],
    fmt: parts.slice(3).join(' ')
  };
};

SDPUtils.parseOLine = function(mediaSection) {
  var line = SDPUtils.matchPrefix(mediaSection, 'o=')[0];
  var parts = line.substr(2).split(' ');
  return {
    username: parts[0],
    sessionId: parts[1],
    sessionVersion: parseInt(parts[2], 10),
    netType: parts[3],
    addressType: parts[4],
    address: parts[5],
  };
}

// Expose public methods.
if (typeof module === 'object') {
  module.exports = SDPUtils;
}

},{}],44:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],45:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],46:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":45,"_process":39,"inherits":44}],47:[function(require,module,exports){
module.exports={
  "name": "twilio-client",
  "version": "1.4.30",
  "description": "Javascript SDK for Twilio Client",
  "homepage": "https://www.twilio.com/docs/client/twilio-js",
  "main": "./es5/twilio.js",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git@code.hq.twilio.com:client/twiliojs.git"
  },
  "scripts": {
    "build": "npm-run-all clean build:es5 build:js build:min.js",
    "build:es5": "rimraf ./es5 && babel lib -d es5",
    "build:js": "node ./scripts/build.js ./lib/browser.js ./LICENSE.md ./dist/twilio.js",
    "build:min.js": "uglifyjs ./dist/twilio.js -o ./dist/twilio.min.js --comments \"/^! twilio-client.js/\" -b beautify=false,ascii_only=true",
    "build:travis": "npm-run-all lint build test:unit test:webpack",
    "clean": "rimraf ./coverage ./dist ./es5",
    "coverage": "nyc --reporter=html ./node_modules/mocha/bin/mocha  --reporter=spec tests/index.js",
    "extension": "browserify -t brfs extension/token/index.js > extension/token.js",
    "lint": "eslint lib",
    "release": "release",
    "start": "node server.js",
    "test": "npm-run-all test:unit test:frameworks",
    "test:framework:no-framework": "mocha tests/framework/no-framework.js",
    "test:framework:react:install": "cd ./tests/framework/react && rimraf ./node_modules package-lock.json && npm install",
    "test:framework:react:build": "cd ./tests/framework/react && npm run build",
    "test:framework:react:run": "mocha ./tests/framework/react.js",
    "test:framework:react": "npm-run-all test:framework:react:*",
    "test:frameworks": "npm-run-all test:framework:no-framework test:framework:react",
    "test:selenium": "mocha tests/browser/index.js",
    "test:unit": "mocha --reporter=spec ./tests/index.js",
    "test:webpack": "cd ./tests/webpack && npm install && npm test"
  },
  "devDependencies": {
    "babel-cli": "^6.26.0",
    "babel-preset-es2015": "^6.24.1",
    "brfs": "^1.4.3",
    "browserify": "^14.3.0",
    "chromedriver": "^2.31.0",
    "envify": "2.0.1",
    "eslint": "3.15.0",
    "express": "^4.14.1",
    "geckodriver": "^1.8.1",
    "js-yaml": "^3.9.1",
    "jsonwebtoken": "^7.4.3",
    "lodash": "^4.17.4",
    "mocha": "^3.5.0",
    "npm-run-all": "^4.1.2",
    "nyc": "^10.1.2",
    "querystring": "^0.2.0",
    "release-tool": "^0.2.2",
    "selenium-webdriver": "^3.5.0",
    "sinon": "^4.0.0",
    "twilio": "^2.11.1",
    "uglify-js": "^3.3.11",
    "vinyl-fs": "^3.0.2",
    "vinyl-source-stream": "^2.0.0"
  },
  "dependencies": {
    "AudioPlayer": "git+https://github.com/twilio/AudioPlayer.git#1.0.1",
    "rtcpeerconnection-shim": "^1.2.8",
    "ws": "0.4.31",
    "xmlhttprequest": "^1.8.0"
  },
  "browser": {
    "xmlhttprequest": "./browser/xmlhttprequest.js",
    "ws": "./browser/ws.js"
  }
}

},{}]},{},[3]);
;
  var Voice = bundle(3);
  /* globals define */
  if (typeof define === 'function' && define.amd) {
    define([], function() { return Voice; });
  } else {
    var Twilio = root.Twilio = root.Twilio || {};
    Twilio.Connection = Twilio.Connection || Voice.Connection;
    Twilio.Device = Twilio.Device || Voice.Device;
    Twilio.PStream = Twilio.PStream || Voice.PStream;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
