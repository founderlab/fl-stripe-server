import _ from 'lodash'
import createStripe from 'stripe'
import {createAuthMiddleware} from 'fl-auth-server'
import createStripeCustomer from './models/createStripeCustomer'

const defaults = {
  route: '/api/stripe',
  manualAuthorisation: false,
  customerWhitelist: ['id'],
}

function sendError(res, err, msg) {
  console.log('[fl-stripe-server] error:', err)
  res.status(500).send(message)
}

export default function createStripeController(_options) {
  const options = _.defaults(_options, defaults)
  const {app, User} = options
  if (!app) return console.error('createStripeController requires an `app` option, got', _options)
  if (!User) return console.error('createStripeController requires a `User` option, got', _options)

  const StripeCustomer = options.StripeCustomer || createStripeCustomer(User)
  const stripe = createStripe(options.apiKey || process.env.STRIPE_API_KEY)

  // Authorisation check. Make sure we can only work with cards (StripeCustomer models) belonging to the logged in user
  function canAccess(options, callback) {
    const {user, req} = options
    if (!user) return callback(null, false)
    if (user.admin || user.get('admin')) return callback(null, true)

    // Allow access for the owner of the profile
    if (req.method === 'GET' && query.user_id == user.id) {
      return callback(null, true)
    }

    // Allow creating for logged in user, charging cards
    else if (req.method === 'POST' && req.body.user_id == user.id) {
      return callback(null, true)
    }

    // // Allow users to charge their cards
    // else if (req.method === 'PUT') {
    //   return StripeCustomer.exists({id: req.params.id, user_id: user.id}, callback)
    // }

    callback(null, false)
  }

  const auth = options.manualAuthorisation ? options.auth : [...options.auth, createAuthMiddleware({canAccess})]


  function createCard(req, res) {
    const token = req.body.token // obtained with Stripe.js
    const user_id = req.user.id
    const msg = 'Error creating stripe customer'
    let customer = null

    // Check for an existing (local) stripe customer record
    StripeCustomer.findOne({user_id: req.query.user_id}, (err, _customer) => {
      if (err) return sendError(res, err, 'Error creating new customer')
      customer = _customer
      const queue = new Queue(1)

      // Create a new customer if we don't have one
      if (!customer) queue.defer(callback => {
        stripe.customers.create({description: `User ${user.get('email')}`, source: token}, (err, customerJSON) => {
          if (err) return sendError(res, err, 'Stripe error creating customer')
          console.log('customerJSON', customerJSON)

          customer = new StripeCustomer({user_id: user.id, stripeId: customerJSON.id})
          customer.save(err => {
            if (err) return sendError(res, err, 'Error saving new customer')
          })
        })

      })

      // Add the new card to the current record if we do
      else queue.defer(callback => {
        stripe.customers.createSource(customer.get('stripeId'), {source: token}, err => {
          if (err) return sendError(res, err, 'Stripe error creating new card')
          callback()
        })
      })

      queue.await(err => {
        if (err) return sendError(res, err)
        res.json({id: customer.id})
      })

    })


      // const customer = new StripeCustomer({token, user_id})
      // customer.save(err => {
      //   if (err) return sendError(res, err, 'Error saving payment information')
      //   res.json({id: customer.id})
      // })
  }

  function listCards(req, res) {
    StripeCustomer.cursor({user_id: req.query.user_id}).select(options.customerWhitelist).toJSON((err, customers) => {
      if (err) return sendError(res, err, 'Error retrieving payment information')

      stripe.customers.listCards('cus_96yeiExgGaCRSE', function(err, cards) {
        // asynchronously called
      });
      res.json(customers)
      // lookup stripe customer?
    })
  }

  function deleteCard(req, res) {

  }

  function chargeCustomer(req, res) {

  }

  app.get(`${options.route}/cards`, options.auth, listCards)
  app.post(`${options.route}/cards`, options.auth, createCard)
  app.del(`${options.route}/cards`, options.auth, deleteCard)

  app.post(`${options.route}/charge`, options.auth, chargeCustomer)

  return {
    canAccess,
    createCustomer,
    listCustomers,
    charge,
    StripeCustomer,
  }
}
