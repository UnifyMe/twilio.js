# twilio.js

Un-official repo for un-browserify-ied source code of Twilio Client Javascript SDK

This project host an unbrowserified version of [Twilio](https://www.twilio.com)
[Javascript Client SDK](https://www.twilio.com/docs/api/client/twilio-js),
that's oficially available only as a standalone browser Javascript
[script file](http://media.twiliocdn.com/sdk/js/client/releases/1.4.24/twilio.js).
The purposse of this project is to allow to easily use it on projects following
a Node.js-based workflow (for example `webpack` or ReactNative), but also
provide some improvements towards this end and some fix-ups and optimizations,
and maybe also allow to update it to use newer APIs like `Promises` or `fetch()`.

`twilio.js` file has been extracted by using [UnifyMe](http://www.unifyme.io)
improved version of [unbrowserify](https://github.com/UnifyMe/unbrowserify),
hosting the unmodified Twilio extracted files at the [upstream](tree/upstream)
branch, hosting the `master` branch the improved ones.
