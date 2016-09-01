'use strict';

exports.__esModule = true;
exports['default'] = createStripeController;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _stripe = require('stripe');

var _stripe2 = _interopRequireDefault(_stripe);

var _flAuthServer = require('fl-auth-server');

var _modelsCreateStripeCustomer = require('./models/createStripeCustomer');

var _modelsCreateStripeCustomer2 = _interopRequireDefault(_modelsCreateStripeCustomer);

var defaults = {
  route: '/api/stripe',
  manualAuthorisation: false,
  customerWhitelist: ['id']
};

function sendError(res, err, msg) {
  console.log('[fl-stripe-server] error:', err);
  res.status(500).send(message);
}

function createStripeController(_options) {
  var options = _lodash2['default'].defaults(_options, defaults);
  var app = options.app;
  var User = options.User;

  if (!app) return console.error('createStripeController requires an `app` option, got', _options);
  if (!User) return console.error('createStripeController requires a `User` option, got', _options);

  var StripeCustomer = options.StripeCustomer || _modelsCreateStripeCustomer2['default'](User);
  var stripe = _stripe2['default'](options.apiKey || process.env.STRIPE_API_KEY);

  // Authorisation check. Make sure we can only work with cards (StripeCustomer models) belonging to the logged in user
  function canAccess(options, callback) {
    var user = options.user;
    var req = options.req;

    if (!user) return callback(null, false);
    if (user.admin || user.get('admin')) return callback(null, true);

    // Allow access for the owner of the profile
    if (req.method === 'GET' && query.user_id == user.id) {
      return callback(null, true);
    }

    // Allow creating for logged in user, charging cards
    else if (req.method === 'POST' && req.body.user_id == user.id) {
        return callback(null, true);
      }

    // // Allow users to charge their cards
    // else if (req.method === 'PUT') {
    //   return StripeCustomer.exists({id: req.params.id, user_id: user.id}, callback)
    // }

    callback(null, false);
  }

  var auth = options.manualAuthorisation ? options.auth : [].concat(options.auth, [_flAuthServer.createAuthMiddleware({ canAccess: canAccess })]);

  function createCard(req, res) {
    var token = req.body.token; // obtained with Stripe.js
    var user_id = req.user.id;
    var msg = 'Error creating stripe customer';
    var customer = null;

    // Check for an existing (local) stripe customer record
    StripeCustomer.findOne({ user_id: req.query.user_id }, function (err, _customer) {
      if (err) return sendError(res, err, 'Error creating new customer');
      customer = _customer;
      var queue = new Queue(1);

      // Create a new customer if we don't have one
      if (!customer) queue.defer(function (callback) {
        stripe.customers.create({ description: 'User ' + user.get('email'), source: token }, function (err, customerJSON) {
          if (err) return sendError(res, err, 'Stripe error creating customer');
          console.log('customerJSON', customerJSON);

          customer = new StripeCustomer({ user_id: user.id, stripeId: customerJSON.id });
          customer.save(function (err) {
            if (err) return sendError(res, err, 'Error saving new customer');
          });
        });
      });

      // Add the new card to the current record if we do
      else queue.defer(function (callback) {
          stripe.customers.createSource(customer.get('stripeId'), { source: token }, function (err) {
            if (err) return sendError(res, err, 'Stripe error creating new card');
            callback();
          });
        });

      queue.await(function (err) {
        if (err) return sendError(res, err);
        res.json({ id: customer.id });
      });
    });

    // const customer = new StripeCustomer({token, user_id})
    // customer.save(err => {
    //   if (err) return sendError(res, err, 'Error saving payment information')
    //   res.json({id: customer.id})
    // })
  }

  function listCards(req, res) {
    StripeCustomer.cursor({ user_id: req.query.user_id }).select(options.customerWhitelist).toJSON(function (err, customers) {
      if (err) return sendError(res, err, 'Error retrieving payment information');

      stripe.customers.listCards('cus_96yeiExgGaCRSE', function (err, cards) {
        // asynchronously called
      });
      res.json(customers);
      // lookup stripe customer?
    });
  }

  function deleteCard(req, res) {}

  function chargeCustomer(req, res) {}

  app.get(options.route + '/cards', options.auth, listCards);
  app.post(options.route + '/cards', options.auth, createCard);
  app.del(options.route + '/cards', options.auth, deleteCard);

  app.post(options.route + '/charge', options.auth, chargeCustomer);

  return {
    canAccess: canAccess,
    createCustomer: createCustomer,
    listCustomers: listCustomers,
    charge: charge,
    StripeCustomer: StripeCustomer
  };
}

module.exports = exports['default'];