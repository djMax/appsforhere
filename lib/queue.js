/*─────────────────────────────────────────────────────────*\
 |  Copyright (C) 2014 PayPal                               |
 |                                                          |
 |  AppsForHere - Advanced integration for PayPal Here and  |
 |  the PayPal retail family of products.                   |
 |                                                          |
 \*────────────────────────────────────────────────────────*/
'use strict';

var logger = require('pine')(),
    Queue = require('mongodb-queue'),
    mongoose = require('mongoose'),
    dust = require('dustjs-linkedin'),
    fs = require('fs'), path = require('path'),
    qs = require('querystring'),
    wreck = require('wreck'),
    twilio = null,
    twilioNumber = null,
    mailgunKey = null;

var q = {
    notificationQueue: null,
    notificationTemplates: {},
    init: function (db, config, options) {
        twilio = require('twilio')(config.get('twilio').sid, config.get('twilio').auth);
        twilioNumber = config.get('twilio').number;
        mailgunKey = config.get('mailgun').key;
        db.once('connected', function cb() {
            q.notificationQueue = Queue(db, 'notification-queue');
            addDeadLetter(q.notificationQueue);
            q.notificationQueue.ensureIndexes(function (err) {
                if (err) {
                    logger.error('Queue index creation failed: %s\n%s', err.message, err.stack);
                } else {
                    logger.verbose('Queue open');
                    // Allow configuration of whether/which queues we will process messages for
                    if (!options || options.process || options.processNotifications) {
                        watchNotifications();
                    }
                }
            });
        });
    }
};

function addDeadLetter(queue) {
    queue.deadLetter = function (n) {
        new mongoose.models.DeadLetter({
            queue: queue.name,
            payload: n.payload
        }).save(function (err, msg) {
                if (!err) {
                    queue.ack(n.ack, function (ackErr) {
                        if (ackErr) {
                            logger.error('Failed to ACK queue message #%s: %s\n%s', n.id, ackErr.message, ackErr.stack);
                        }
                    });
                }
            });
    };
}

if (!mongoose.model.DeadLetter) {
    var deadLetter = mongoose.Schema({
        queue: String,
        payload: mongoose.Schema.Types.Mixed
    });
    mongoose.model('DeadLetter', deadLetter);
}

function watchNotifications() {
    q.notificationQueue.get(function (err, notification) {
        if (err || !notification) {
            if (err) {
                logger.error('Notification queue error: %s\n%s', err.message, err.stack);
            }
            setTimeout(watchNotifications, 2000);
            return;
        }
        try {
            _processNotification(notification);
        } catch (ex) {
            logger.error('Notification queue processing error for #%s: %s\n%j\n%s', notification.id, ex.message, notification.payload, ex.stack);
        } finally {
            watchNotifications();
        }
    });
}

function _processNotification(notification) {
    if (notification.tries > 10) {
        logger.verbose('Notification #%s failed 10 times, pushing to dead letter.', notification.id);
        q.notificationQueue.deadLetter(notification);
        return;
    }
    logger.verbose('Got notification queue message #%s (ack %s, attempt %s).', notification.id, notification.ack, notification.tries);
    if (notification.payload && notification.payload.type === 'sms') {
        sendSms(notification);
    } else if (notification.payload && notification.payload.type === 'email') {
        sendEmail(notification);
    } else {
        logger.verbose('Unknown notification type, pushing to dead letter.');
        q.notificationQueue.deadLetter(notification);
    }
}

var NotificationContext = function (c) {
    this.context = c;
};
NotificationContext.prototype.subject = function (chunk, context, bodies, params) {
    this.mailSubject = dust.helpers.tap(bodies.block, chunk, context);
    return chunk;
};
NotificationContext.prototype.from = function (chunk, context, bodies, params) {
    this.mailFrom = dust.helpers.tap(bodies.block, chunk, context);
    return chunk;
};
NotificationContext.prototype.html = function (chunk, context, bodies, params) {
    this.htmlMessage = dust.helpers.tap(bodies.block, chunk, context);
    return chunk;
};
NotificationContext.prototype.text = function (chunk, context, bodies, params) {
    this.textMessage = dust.helpers.tap(bodies.block, chunk, context);
    return chunk;
};
NotificationContext.prototype.sms = function (chunk, context, bodies, params) {
    this.smsMessage = dust.helpers.tap(bodies.block, chunk, context);
    return chunk;
};

function _loadTemplate(n, fn) {
    var tname = n.payload.template;
    if (!q.notificationTemplates[tname]) {
        var templatePath = path.resolve(__dirname, '../notifications/' + tname + '.dust');
        fs.readFile(templatePath, function (err, file) {
            if (err) {
                logger.error('Failed to read notification template %s - sending to dead letter.', templatePath);
                q.notificationQueue.deadLetter(n);
                return;
            }
            q.notificationTemplates[tname] = dust.compile(file.toString(), tname);
            dust.loadSource(q.notificationTemplates[tname], tname);
            fn();
        });
    }
}

function _buildEmail(n, cb) {
    var tname = n.payload.template;
    var dustContext = new NotificationContext(n.payload.context);
    dust.render(tname, dustContext, function (err, out) {
        if (err) {
            logger.error('Failed to render notification template %s: %s - sending to dead letter.\n%s', tname, err.message, err.stack);
            q.notificationQueue.deadLetter(n);
            return;
        }
        var mailOptions = {
            from: dustContext.mailFrom,
            to: n.payload.context.email,
            subject: dustContext.mailSubject,
            text: dustContext.textMessage,
            html: dustContext.htmlMessage,
            sms: dustContext.smsMessage,
            'o:campaign': tname
        };
        cb(n, mailOptions);
    });
}

function sendEmail(n) {
    _loadTemplate(n, function () {
        _buildEmail(n, _mailgun);
    });
}

function sendSms(n) {
    _loadTemplate(n, function () {
        _buildEmail(n, _twilio);
    });
}

function _mailgun(n, mailOptions) {
    wreck.post('https://api.mailgun.net/v2/appsforhere.com/messages', {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + (new Buffer('api:' + process.env.MAILGUN_KEY).toString('base64'))
        },
        payload: qs.stringify(mailOptions)
    }, function (sendErr, rz) {
        if (sendErr) {
            logger.error('Email sending error: %s', sendErr.message);
        } else if (rz.statusCode < 200 || rz.statusCode > 299) {
            logger.error('Email sending error: %s\n%s', rz.statusCode, rz.body.toString());
        } else {
            q.notificationQueue.ack(n.ack, function (ackErr) {
                if (ackErr) {
                    logger.error('Failed to ack SUCCESSFULLY processed notification message #%s: %s\n%s', n.id, ackErr.message, ackErr.stack);
                } else {
                    logger.verbose('Completed processing notification %s.', n.id);
                }
            });
        }
    });
}

function _twilio(n, mailOptions) {
    twilio.messages.create({
        to: n.payload.context.sms,
        from: twilioNumber,
        body: mailOptions.sms
    }, function (sendErr, message) {
        if (sendErr) {
            logger.error('SMS sending error: %s', sendErr.message);
        } else {
            q.notificationQueue.ack(n.ack, function (ackErr) {
                if (ackErr) {
                    logger.error('Failed to ack SUCCESSFULLY processed notification message #%s: %s\n%s', n.id, ackErr.message, ackErr.stack);
                } else {
                    logger.verbose('Completed processing notification %s.', n.id);
                }
            });
        }
    });
}

module.exports = q;
