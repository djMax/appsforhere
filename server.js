'use strict';

var logger = require('pine')();

if (process.env.NODE_ENV === 'production') {
    logger.info("Starting newrelic agent.");
    require('newrelic');
} else {
    logger.info("newrelic inactive (%s).", process.env.NODE_ENV || 'no NODE_ENV set');
}

if (process.env.LONGJOHN) {
    logger.info('Activating longjohn for better stack traces.');
    require('longjohn');
}

var app = new (require('./index'))();
app.once('ready', function () {
   app.listen(process.env.PORT || 8000);
});
