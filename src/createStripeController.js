import _ from 'lodash'
import Queue from 'queue-async'
import createStripe from 'stripe'
import {createAuthMiddleware} from 'fl-auth-server'
import createStripeCustomer from './models/createStripeCustomer'

const defaults = {
  route: '/api/stripe',
  manualAuthorisation: false,
  cardWhitelist: ['id', 'country', 'brand', 'last4'],
}

function sendError(res, err, msg) {
  console.log('[fl-stripe-server] error:', err)
  res.status(500).send(msg)
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
    if (req.method === 'GET' && req.query.user_id === user.id.toString()) {
      return callback(null, true)
    }

    // Allow creating for logged in user, charging cards
    else if (req.method === 'POST' && req.body.user_id === user.id.toString()) {
      return callback(null, true)
    }

    // // Allow users to charge their cards
    // else if (req.method === 'PUT') {
    //   return StripeCustomer.exists({id: req.params.id, user_id: user.id}, callback)
    // }

    callback(null, false)
  }

  function createCard(req, res) {
    const token = req.body.token // obtained with Stripe.js
    const user_id = req.user.id
    let customer = null

    // Check for an existing (local) stripe customer record
    StripeCustomer.findOne({user_id}, (err, _customer) => {
      if (err) return sendError(res, err, 'Error creating new customer')
      customer = _customer
      const queue = new Queue(1)

      // Create a new customer if we don't have one
      if (!customer) {
        queue.defer(callback => {
          stripe.customers.create({description: `User ${req.user.get('email')}`, source: token}, (err, customerJSON) => {
            if (err) return sendError(res, err, 'Stripe error creating customer')

            customer = new StripeCustomer({user_id, stripeId: customerJSON.id})
            customer.save(err => {
              if (err) return sendError(res, err, 'Error saving new customer')
              callback()
            })
          })

        })
      }

      // Add the new card to the current record if we do
      else {
        queue.defer(callback => {
          stripe.customers.createSource(customer.get('stripeId'), {source: token}, err => {
            if (err) return sendError(res, err, 'Stripe error creating new card')
            callback()
          })
        })
      }

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
    const user_id = req.user.id

    StripeCustomer.findOne({user_id}, (err, customer) => {
      if (err) return sendError(res, err, 'Error retrieving payment information')
      if (!customer) return res.status(404)

      stripe.customers.listCards(customer.get('stripeId'), (err, json) => {
        if (err) return sendError(res, err, 'Stripe error retrieving payment information')
        res.json(_.map(json.data, card => _.pick(card, options.cardWhitelist)))
      })
    })
  }

  function deleteCard(req, res) {
    const user_id = req.user.id
    const cardId = req.body.id

    // Check for an existing (local) stripe customer record
    StripeCustomer.findOne({user_id}, (err, customer) => {
      if (err) return sendError(res, err, 'Error creating new customer')
      if (!customer) return res.status(404)

      stripe.customers.deleteCard(customer.get('stripeId'), cardId, err => {
        if (err) return sendError(res, err, 'Stripe error creating new card')
        res.json({id: customer.id})
      })
    })

  }

  function chargeCard(req, res) {
    return res.json({})
  }

  const auth = options.manualAuthorisation ? options.auth : [...options.auth, createAuthMiddleware({canAccess})]

  app.post(`${options.route}/cards`, auth, createCard)
  app.get(`${options.route}/cards`, auth, listCards)
  app.delete(`${options.route}/cards`, auth, deleteCard)

  app.post(`${options.route}/charge`, auth, chargeCard)

  return {
    canAccess,
    createCard,
    listCards,
    deleteCard,
    chargeCard,
    StripeCustomer,
  }
}
