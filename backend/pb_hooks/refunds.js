// A durable request belongs to named tickets. Replays reuse its Stripe idempotency key.
function stripe(method,path,data,key) {return require(__hooks+'/checkout.js').stripe(method,path,data,key);}
function ids(record) {try{return JSON.parse(record.getString('ticket_ids')) || [];}catch(_){return [];}}
function pending(status) {return ['requesting','pending','requires_action'].indexOf(status)>=0;}
function unit(order) {
  var amount=order.getInt('amount')/order.getInt('quantity');
  if(!Number.isInteger(amount) || amount<1)throw new BadRequestError('Ticket price unavailable');
  return amount;
}
function rows(app,order) {return app.findRecordsByFilter('ticket_refunds','order = {:order}','created,id',1000,0,{order:order.id});}
function active(order,ticket) {return ['paid','partially_refunded'].indexOf(order.getString('status'))>=0 && !ticket.getString('refunded_at');}
function find(app,body) {
  var ticket;
  try {ticket=app.findRecordById('tickets',String(body.ticket_id || ''));}catch(_){throw new NotFoundError('Ticket not found');}
  var order=app.findRecordById('orders',ticket.getString('order'));
  if(!body.event_id || order.getString('event_id')!==body.event_id)throw new BadRequestError('Ticket belongs to another event');
  if(['paid','partially_refunded','refunded'].indexOf(order.getString('status'))<0)throw new BadRequestError('Ticket is not paid');
  return {ticket:ticket,order:order};
}
function summary(app,order) {
  var price=unit(order),unassigned=0,unassignedPending=0,committed=0,existing=[];
  rows(app,order).forEach(function(row){
    var status=row.getString('status'),remaining=Math.max(0,row.getInt('amount')-ids(row).length*price);
    if(status==='succeeded' || pending(status))committed+=row.getInt('amount');
    if(status==='succeeded' && remaining){
      unassigned+=remaining;
      if(remaining>=price)existing.push({id:row.id,amount:row.getInt('amount'),remaining:remaining,created:row.getString('created')});
    }
    if(pending(status) && !ids(row).length)unassignedPending+=row.getInt('amount');
  });
  return {unit_amount:price,unassigned_amount:unassigned,unassigned_pending:unassignedPending,committed:committed,existing:existing};
}
// Recompute admission from confirmed refunds; a failed asynchronous refund restores the ticket.
function apply(app,order) {
  var refunds=rows(app,order),succeeded={},inProgress={},last={},total=0;
  refunds.forEach(function(row){
    var state=row.getString('status');
    if(state==='succeeded')total+=row.getInt('amount');
    ids(row).forEach(function(id){last[id]=row;if(state==='succeeded')succeeded[id]=row;else if(pending(state))inProgress[id]=row;});
  });
  order.set('refunded_amount',total);order.set('status',total>=order.getInt('amount')?'refunded':total>0?'partially_refunded':'paid');app.save(order);
  app.findRecordsByFilter('tickets','order = {:order}','position',10,0,{order:order.id}).forEach(function(ticket){
    var refund=succeeded[ticket.id] || inProgress[ticket.id] || last[ticket.id];
    var cancelled=order.getString('status')==='refunded' || !!succeeded[ticket.id];
    ticket.set('refunded_at',cancelled?(ticket.getString('refunded_at') || new Date().toISOString()):'');
    ticket.set('refund_state',cancelled?'succeeded':refund?refund.getString('status'):'');
    ticket.set('refund_request',refund?refund.id:'');app.save(ticket);
  });
}
exports.sync=function(order,charge) {
  if(charge.livemode!==false || charge.currency!==order.getString('currency') || charge.amount!==order.getInt('amount'))throw new Error('Refund does not match order');
  var version;
  $app.runInTransaction(function(app){var current=app.findRecordById('orders',order.id);version=current.getInt('refund_sync_version')+1;current.set('refund_sync_version',version);app.save(current);});
  var all=[],after='';
  do {
    var page=stripe('GET','refunds?charge='+encodeURIComponent(charge.id)+'&limit=100'+(after?'&starting_after='+encodeURIComponent(after):''));
    all=all.concat(page.data);after=page.has_more?page.data[page.data.length-1].id:'';
  }while(after);
  $app.runInTransaction(function(app){
    var current=app.findRecordById('orders',order.id);
    // A slower, older fetch cannot roll back a newer refund result.
    if(current.getInt('refund_sync_version')!==version)return;
    all.forEach(function(item){
      if(item.charge!==charge.id || item.currency!==current.getString('currency'))throw new Error('Refund does not match charge');
      var row=null;
      try {row=app.findFirstRecordByFilter('ticket_refunds','stripe_id = {:id}',{id:item.id});}catch(_){}
      if(!row && item.metadata && item.metadata.ticket_refund_id){
        try {row=app.findRecordById('ticket_refunds',item.metadata.ticket_refund_id);}catch(_){}
        if(row && (row.getString('order')!==current.id || row.getInt('amount')!==item.amount || (row.getString('stripe_id') && row.getString('stripe_id')!==item.id)))throw new Error('Refund request mismatch');
      }
      if(!row){row=new Record(app.findCollectionByNameOrId('ticket_refunds'));row.set('order',current.id);row.set('source','stripe');row.set('ticket_ids',[]);}
      if(row.getString('order')!==current.id)throw new Error('Refund order mismatch');
      row.set('stripe_id',item.id);row.set('amount',item.amount);row.set('currency',item.currency);row.set('status',item.status);
      row.set('failure_reason',item.failure_reason || '');app.save(row);
    });
    current.set('stripe_payment_intent',charge.payment_intent);apply(app,current);
  });
};
function syncOrder(order) {
  var payment=order.getString('stripe_payment_intent');
  if(!payment || !/^pi_[a-zA-Z0-9]+$/.test(payment))throw new BadRequestError('Payment reference unavailable');
  var intent=stripe('GET','payment_intents/'+payment);
  if(intent.livemode!==false || intent.amount!==order.getInt('amount') || intent.currency!==order.getString('currency'))throw new Error('Payment does not match order');
  var charge=typeof intent.latest_charge==='string'?intent.latest_charge:intent.latest_charge && intent.latest_charge.id;
  if(!charge)throw new BadRequestError('Payment reference unavailable');
  require(__hooks+'/checkout.js').syncRefund(charge);
  return $app.findRecordById('orders',order.id);
}
function describe(app,data) {
  var s=summary(app,data.order),ticket=data.ticket,state=ticket.getString('refund_state'),request=null;
  try {request=app.findRecordById('ticket_refunds',ticket.getString('refund_request'));}catch(_){}
  return {ticket_id:ticket.id,name:ticket.getString('name'),number:String(ticket.getInt('number')).padStart(3,'0'),currency:data.order.getString('currency'),
    amount:s.unit_amount,status:active(data.order,ticket)?state || 'available':'succeeded',checked_in:ticket.getString('checked_in'),
    existing:s.existing,unassigned_amount:s.unassigned_amount,unassigned_pending:s.unassigned_pending,
    can_refund:active(data.order,ticket) && !s.unassigned_amount && !s.unassigned_pending && (!request || !pending(state) || state==='requesting'),
    failure_reason:request?request.getString('failure_reason'):''};
}
exports.options=function(body) {
  var data=find($app,body);syncOrder(data.order);return describe($app,find($app,body));
};
exports.request=function(body,operator) {
  if(['refund','existing'].indexOf(body.mode)<0)throw new BadRequestError('Choose refund action');
  var data=find($app,body);syncOrder(data.order);var requestId='',already=false;
  $app.runInTransaction(function(app){
    data=find(app,body);
    if(!active(data.order,data.ticket)){already=true;return;}
    var s=summary(app,data.order),previous=null;
    try {previous=app.findRecordById('ticket_refunds',data.ticket.getString('refund_request'));}catch(_){}
    if(previous && pending(previous.getString('status'))){
      if(body.mode!=='refund')throw new BadRequestError('Refund already pending');
      requestId=previous.id;return;
    }
    if(body.mode==='existing'){
      var row;
      try {row=app.findRecordById('ticket_refunds',String(body.refund_id || ''));}catch(_){throw new BadRequestError('Refund not found');}
      if(row.getString('order')!==data.order.id || row.getString('status')!=='succeeded')throw new BadRequestError('Refund does not match ticket');
      var assigned=ids(row);
      if(row.getInt('amount')-assigned.length*s.unit_amount<s.unit_amount)throw new BadRequestError('Refund already assigned');
      assigned.push(data.ticket.id);row.set('ticket_ids',assigned);row.set('requested_by',operator.id);app.save(row);apply(app,data.order);return;
    }
    if(s.unassigned_amount)throw new BadRequestError('Choose existing refund');
    if(s.unassigned_pending)throw new BadRequestError('Refund already pending');
    if(s.committed+s.unit_amount>data.order.getInt('amount'))throw new BadRequestError('Refund exceeds payment');
    var row=new Record(app.findCollectionByNameOrId('ticket_refunds'));
    row.load({order:data.order.id,ticket_ids:[data.ticket.id],amount:s.unit_amount,currency:data.order.getString('currency'),status:'requesting',source:'admin',requested_by:operator.id});
    row.set('idempotency_key','ticket-refund-'+$security.randomString(32));app.save(row);
    data.ticket.set('refund_request',row.id);data.ticket.set('refund_state','requesting');app.save(data.ticket);requestId=row.id;
  });
  if(requestId){
    var request=$app.findRecordById('ticket_refunds',requestId);
    if(request.getString('status')==='requesting' && !request.getString('stripe_id')){
      // Stripe retains v1 keys for at least 24h. Never resubmit an unresolved older request.
      if(Date.now()-Date.parse(request.getString('created'))>=23*3600000)throw new BadRequestError('Refund needs reconciliation');
      var refund=stripe('POST','refunds',{payment_intent:data.order.getString('stripe_payment_intent'),amount:request.getInt('amount'),reason:'requested_by_customer',
        'metadata[ticket_refund_id]':request.id,'metadata[order_id]':data.order.id,'metadata[ticket_id]':ids(request)[0]},request.getString('idempotency_key'));
      if(refund.payment_intent!==data.order.getString('stripe_payment_intent') || refund.amount!==request.getInt('amount') || refund.currency!==request.getString('currency'))throw new Error('Refund response mismatch');
      $app.runInTransaction(function(app){
        var current=app.findRecordById('ticket_refunds',requestId);
        // Record a confirmed response immediately. A webhook may already have
        // recorded a later bank result, which this older response must not replace.
        if(current.getString('status')==='requesting' && !current.getString('stripe_id')){
          current.set('stripe_id',refund.id);current.set('status',refund.status);current.set('failure_reason',refund.failure_reason || '');app.save(current);
          apply(app,app.findRecordById('orders',data.order.id));
        }
      });
      // Reconciliation also handles a webhook that beat this HTTP response.
      syncOrder(data.order);
    }
  }
  return {already_refunded:already,refund:describe($app,find($app,body))};
};
exports.reconcilePending=function() {
  // Pending requests need reconciliation even if a webhook was missed. Also watch recent
  // successful refunds because a customer's bank can report a later failure.
  var recent=new Date(Date.now()-86400000).toISOString().replace('T',' '),seen={};
  $app.findRecordsByFilter('ticket_refunds','status = "requesting" || status = "pending" || status = "requires_action" || (status = "succeeded" && created >= {:recent})','created',100,0,{recent:recent}).forEach(function(row){
    var id=row.getString('order');if(seen[id])return;seen[id]=true;
    try {syncOrder($app.findRecordById('orders',id));}catch(err){console.log('[refunds] Reconciliation pending for '+id+': '+err.message);}
  });
};
