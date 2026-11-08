// Prices are server-owned. No price or payment status is accepted from the browser.
function config() {
  var key = $os.getenv('STRIPE_SECRET_KEY');
  var origin = $os.getenv('CHECKOUT_ORIGIN');
  if ($os.getenv('CHECKOUT_ENABLED') !== 'true' || !/^sk_test_/.test(key) || !/^https?:\/\//.test(origin)) throw new ApiError(503, 'Checkout unavailable');
  return {key:key, origin:origin.replace(/\/$/, '')};
}
function stripe(method, path, data, idempotency) {
  var cfg = config();
  var headers = {'Authorization':'Bearer '+cfg.key, 'Stripe-Version':'2025-02-24.acacia'};
  if (idempotency) headers['Idempotency-Key'] = idempotency;
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  var response = $http.send({url:'https://api.stripe.com/v1/'+path, method:method, headers:headers,
    body:Object.keys(data || {}).map(function(k) {return encodeURIComponent(k)+'='+encodeURIComponent(data[k]);}).join('&'), timeout:30});
  if (response.statusCode < 200 || response.statusCode > 299) throw new ApiError(502, 'Payment provider unavailable. Please try again.');
  return response.json;
}
function findKey(key) {
  return $app.findFirstRecordByFilter('orders', 'checkout_key = {:key}', {key:key});
}
function validate(body) {
  var b = {};
  ['name','email','phone','message','language','event_id'].forEach(function(k) {b[k] = String(body[k] || '').trim();});
  b.quantity = Number(body.quantity);
  b.newsletter_opt_in = body.newsletter_opt_in === true;
  if (body.terms_accepted !== true) throw new BadRequestError('Consent required');
  b.terms_accepted=true;
  if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 10 || !b.name || b.name.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) || b.email.length > 254 || b.phone.length > 120 || b.message.length > 5000 || ['ru','de','en'].indexOf(b.language) < 0) throw new BadRequestError('Invalid booking details');
  if (!Array.isArray(body.guests) || body.guests.length !== b.quantity) throw new BadRequestError('Name each guest');
  b.guests=body.guests.map(function(guest){
    if (!guest || typeof guest !== 'object') throw new BadRequestError('Invalid guest');
    var g={name:String(guest.name || '').trim(),email:String(guest.email || '').trim(),wishes:String(guest.wishes || '').trim()};
    if (!g.name || g.name.length>180 || g.wishes.length>2000 || g.email.length>254 || (g.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email))) throw new BadRequestError('Invalid guest details');
    return g;
  });
  return b;
}
exports.create = function(e) {
  var cfg = config();
  if (e.request.header.get('Origin') !== cfg.origin) throw new ForbiddenError('Invalid origin');
  var body = e.requestInfo().body;
  var key = String(body.checkout_key || '');
  if (!/^[a-zA-Z0-9-]{32,64}$/.test(key)) throw new BadRequestError('Invalid checkout key');
  var b = validate(body);
  var event = require(__hooks+'/tickets.js').eventBySlug(b.event_id);
  if (!event.enabled || Date.parse(event.starts_at)<=Date.now()) throw new BadRequestError('Event is not on sale');
  reconcileExpired();
  var hash = $security.sha256(JSON.stringify(b));
  var order;
  $app.runInTransaction(function(app) {
    try {order = app.findFirstRecordByFilter('orders','checkout_key = {:key}',{key:key});} catch (_) {}
    if (order) {
      if (order.getString('payload_hash') !== hash) throw new BadRequestError('Booking changed; start a new checkout');
      return;
    }
    var liveEvent=app.findRecordById('checkout_events',event.id);
    var availability=require(__hooks+'/inventory.js').availability(app,liveEvent);
    if (availability.remaining!==null && b.quantity>availability.remaining) throw new ApiError(409,availability.sold_out?'Sold out':'Not enough places');
    order = new Record(app.findCollectionByNameOrId('orders'));
    Object.keys(b).forEach(function(k) {order.set(k,b[k]);});
    order.set('checkout_key',key); order.set('payload_hash',hash); order.set('amount',event.unit_amount*b.quantity);
    order.set('event_snapshot',event);
    order.set('currency',event.currency); order.set('status','pending');
    order.set('hold_until',new Date(Date.now()+3600000).toISOString());
    order.set('consent_at',new Date().toISOString());order.set('consent_version','2026-10-19');
    app.save(order);
  });
  event=JSON.parse(order.getString('event_snapshot'));
  if (['paid','partially_refunded'].indexOf(order.getString('status'))>=0) return e.json(200,{paid:true});
  if (order.getString('status')!=='pending') return e.json(409,{expired:true});
  if (order.getString('stripe_session')) {
    var existing = stripe('GET','checkout/sessions/'+order.getString('stripe_session'));
    if (existing.status !== 'open') return e.json(409,{expired:true});
    return e.json(200,{url:existing.url});
  }
  var data = {
    mode:'payment', 'payment_method_types[0]':'card', 'payment_method_types[1]':'twint', 'adaptive_pricing[enabled]':'false', customer_email:b.email,
    client_reference_id:order.id, 'metadata[order_id]':order.id, 'payment_intent_data[metadata][order_id]':order.id,
    'line_items[0][price_data][currency]':event.currency,
    'line_items[0][price_data][unit_amount]':event.unit_amount,
    'line_items[0][price_data][product_data][name]':event.name+' · '+event.time_label,
    'line_items[0][quantity]':b.quantity, locale:b.language,
    success_url:cfg.origin+'/?payment=return&order='+key+'&language='+b.language,
    cancel_url:cfg.origin+'/?payment=cancel&order='+key+'&language='+b.language,
    expires_at:Math.floor(Date.now()/1000)+3600
  };
  // Stable expiry must not change between retries of an ambiguous Stripe response.
  data.expires_at = Math.floor(Date.parse(order.getString('created'))/1000)+3600;
  if (data.expires_at < Math.floor(Date.now()/1000)+1800) return e.json(409,{expired:true});
  var session = stripe('POST','checkout/sessions',data,'checkout-'+order.id);
  if (session.livemode !== false) throw new ApiError(502,'Unexpected payment mode');
  $app.runInTransaction(function(app) {
    var current = app.findRecordById('orders',order.id);
    current.set('stripe_session',session.id); current.set('checkout_url',session.url); app.save(current);
  });
  return e.json(200,{url:session.url});
};
function fulfill(session) {
  if (session.livemode !== false || session.payment_status !== 'paid' || session.status !== 'complete') return;
  $app.runInTransaction(function(app) {
    var order = app.findRecordById('orders',session.client_reference_id);
    if (!session.metadata || session.metadata.order_id !== order.id || session.amount_total !== order.getInt('amount') || session.currency !== order.getString('currency') || (order.getString('stripe_session') && order.getString('stripe_session') !== session.id)) throw new Error('Payment does not match order');
    order.set('stripe_session',session.id);
    order.set('stripe_payment_intent',typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent.id);
    // A delayed or repeated success event must never resurrect refunded tickets.
    if (['refunded','partially_refunded'].indexOf(order.getString('status'))<0) order.set('status','paid');
    app.save(order);
    require(__hooks+'/tickets.js').issue(app,order);
  });
}
exports.status = function(e) {
  config();
  e.response.header().set('Cache-Control','no-store');
  var key = e.request.pathValue('key');
  if (!/^[a-zA-Z0-9-]{32,64}$/.test(key)) throw new NotFoundError();
  var order;
  try {order=findKey(key);} catch (_) {throw new NotFoundError();}
  // Reconcile from Stripe when the buyer returns before the webhook arrives.
  if (order.getString('status') === 'pending' && order.getString('stripe_session')) {
    var session = stripe('GET','checkout/sessions/'+order.getString('stripe_session'));
    fulfill(session);
    order=findKey(key);
    if (session.status === 'expired' && order.getString('status') !== 'paid') return e.json(200,{status:'expired'});
  }
  var result={status:order.getString('status'), quantity:order.getInt('quantity'), amount:order.getInt('amount'), currency:order.getString('currency')};
  if (['paid','partially_refunded','refunded'].indexOf(result.status)>=0) result.tickets=require(__hooks+'/tickets.js').forBuyer(order);
  return e.json(200,result);
};
exports.webhook = function(e) {
  config();
  var secret=$os.getenv('STRIPE_WEBHOOK_SECRET');
  if (!secret) throw new ApiError(503,'Webhook unavailable');
  var raw=toString(e.request.body);
  var parts=e.request.header.get('Stripe-Signature').split(',');
  var timestamp='', signatures=[];
  parts.forEach(function(part) {var pair=part.split('=');if(pair[0]==='t') timestamp=pair[1];if(pair[0]==='v1') signatures.push(pair[1]);});
  var expected=$security.hs256(timestamp+'.'+raw,secret);
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>300 || !signatures.some(function(sig){return $security.equal(sig,expected);})) throw new BadRequestError('Invalid signature');
  var event=JSON.parse(raw);
  if (event.livemode !== false) throw new BadRequestError('Unexpected payment mode');
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    var id=event.data.object.id;
    if (!/^cs_test_[a-zA-Z0-9]+$/.test(id)) throw new BadRequestError('Invalid session');
    fulfill(stripe('GET','checkout/sessions/'+id));
  }
  if (event.type==='checkout.session.expired') reconcileExpired();
  if (['charge.refunded','refund.created','refund.updated','refund.failed','charge.refund.updated'].indexOf(event.type)>=0) {
    var object=event.data.object, chargeId=event.type==='charge.refunded'?object.id:object.charge;
    if (typeof chargeId==='string' && /^ch_[a-zA-Z0-9]+$/.test(chargeId)) syncRefund(chargeId);
  }
  return e.json(200,{received:true});
};
exports.receipts = function() {
  config();
  reconcileExpired();
  require(__hooks+'/tickets.js').deliver();
};

function reconcileExpired() {
  // PocketBase stores UTC dates with a space, not ISO's T. Compare like formats.
  var orders=$app.findRecordsByFilter('orders','status = "pending" && hold_until <= {:now}','created',100,0,{now:new Date().toISOString().replace('T',' ')});
  orders.forEach(function(order) {
    var id=order.getString('stripe_session');
    if(id) {
      var session=stripe('GET','checkout/sessions/'+id);
      if(session.payment_status==='paid') {fulfill(session);return;}
      if(session.status!=='expired') return;
    }
    $app.runInTransaction(function(app){var current=app.findRecordById('orders',order.id);if(current.getString('status')==='pending'){current.set('status','expired');app.save(current);}});
  });
}
function syncRefund(chargeId) {
  var charge=stripe('GET','charges/'+chargeId);
  if(charge.livemode!==false || !charge.payment_intent) throw new Error('Unexpected refund');
  var order;
  try {order=$app.findFirstRecordByFilter('orders','stripe_payment_intent = {:id}',{id:charge.payment_intent});} catch (_) {
    // Refunds may arrive before the payment webhook; metadata is set at checkout.
    var intent=stripe('GET','payment_intents/'+charge.payment_intent);
    if(!intent.metadata || !intent.metadata.order_id) return;
    try {order=$app.findRecordById('orders',intent.metadata.order_id);}catch(_){return;}
    if(!order.getString('stripe_session')) return;
    fulfill(stripe('GET','checkout/sessions/'+order.getString('stripe_session')));
  }
  if(charge.currency!==order.getString('currency') || charge.amount!==order.getInt('amount')) throw new Error('Refund does not match order');
  // Only completed refunds count. Pending/failed refunds do not invalidate admission.
  var refunded=0,after='';
  do {
    var page=stripe('GET','refunds?charge='+chargeId+'&limit=100'+(after?'&starting_after='+after:''));
    page.data.forEach(function(refund){if(refund.status==='succeeded')refunded+=refund.amount;});
    after=page.has_more?page.data[page.data.length-1].id:'';
  }while(after);
  $app.runInTransaction(function(app){
    var current=app.findRecordById('orders',order.id);
    current.set('stripe_payment_intent',charge.payment_intent);current.set('refunded_amount',refunded);
    current.set('status',refunded>=current.getInt('amount')?'refunded':refunded>0?'partially_refunded':'paid');
    app.save(current);
  });
}
exports.availability=function(e) {
  config();e.response.header().set('Cache-Control','no-store');reconcileExpired();
  var event=$app.findFirstRecordByFilter('checkout_events','slug = {:slug}',{slug:e.request.pathValue('slug')});
  return e.json(200,require(__hooks+'/inventory.js').availability($app,event));
};
