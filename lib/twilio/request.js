"use strict";

var XHR = typeof XMLHttpRequest === "undefined" ? require("xmlhttprequest").XMLHttpRequest : XMLHttpRequest;

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

var Request = request;

Request.get = function get(params, callback) {
    return new this("GET", params, callback);
};

Request.post = function post(params, callback) {
    return new this("POST", params, callback);
};

module.exports = Request;