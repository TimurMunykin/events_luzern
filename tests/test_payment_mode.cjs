// No Stripe network access: exercise live/test boundaries with signed webhook payloads.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const hooks=path.resolve(__dirname,'../backend/pb_hooks');
const testEnv={APP_ENV:'staging',CHECKOUT_ENABLED:'true',STRIPE_MODE:'test',
  STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',
  CHECKOUT_ORIGIN:'http://localhost:8091',CHECKOUT_NOTIFY_TO:'owner@example.com'};
const liveEnv={...testEnv,APP_ENV:'production',STRIPE_MODE:'live',STRIPE_SECRET_KEY:'rk_live_fixture',CHECKOUT_ORIGIN:'https://events.example.com'};
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
class BadRequestError extends ApiError {constructor(message){super(400,message);}}
function runtime(env) {
  const cache={},calls=[];
  const context={$os:{getenv:key=>env[key] || ''},__hooks:hooks,ApiError,BadRequestError,
    toString:value=>String(value),$security:{hs256:(text,key)=>crypto.createHmac('sha256',key).update(text).digest('hex'),equal:(a,b)=>a===b},
    $http:{send:request=>{calls.push(request);return {statusCode:200,json:{livemode:env.STRIPE_MODE==='live',payment_status:'unpaid',status:'open'}};}}};
  function load(file) {
    if(cache[file])return cache[file];
    const exports={};cache[file]=exports;
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{...context,exports,require:load},{filename:file});
    return exports;
  }
  return {settings:load(path.join(hooks,'payment_config.js')),checkout:load(path.join(hooks,'checkout.js')),calls};
}
function webhook(api,body,secret='whsec_fixture') {
  const raw=JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000));
  const digest=crypto.createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
  return api.checkout.webhook({request:{body:raw,header:{get:()=>`t=${timestamp},v1=${digest}`}},json:(status,body)=>({status,body})});
}
test('existing sandbox and explicit production modes accept only their own keys',()=>{
  for(const env of [testEnv,{...testEnv,STRIPE_MODE:''},liveEnv,{...liveEnv,STRIPE_SECRET_KEY:'sk_live_fixture'}]) {
    const {settings}=runtime(env);
    assert.equal(settings.config().live,env.APP_ENV==='production');
  }
  for(const changes of [{APP_ENV:'staging'},{APP_ENV:''},{STRIPE_MODE:'test'},{STRIPE_SECRET_KEY:'sk_test_fixture'},
    {STRIPE_SECRET_KEY:'pk_live_fixture'},{CHECKOUT_ENABLED:'false'},{CHECKOUT_ORIGIN:'http://events.example.com'},
    {CHECKOUT_ORIGIN:'https://events.example.com/path'},{STRIPE_WEBHOOK_SECRET:''},{CHECKOUT_NOTIFY_TO:''}]) {
    assert.throws(()=>runtime({...liveEnv,...changes}).settings.config(),error=>error.status===503);
  }
  assert.throws(()=>runtime({...testEnv,STRIPE_SECRET_KEY:'rk_live_fixture'}).settings.config(),error=>error.status===503);
});
test('signed test events cannot enter production, and live events cannot enter staging',()=>{
  for(const env of [testEnv,liveEnv]) {
    const api=runtime(env),live=env.STRIPE_MODE==='live';
    assert.equal(webhook(api,{livemode:live,type:'ignored.fixture'}).status,200);
    for(const mode of [!live,undefined,'true'])assert.throws(()=>webhook(api,{livemode:mode,type:'ignored.fixture'}),error=>error.status===400);
    assert.throws(()=>webhook(api,{livemode:live,type:'ignored.fixture'},'wrong-secret'),error=>error.status===400);
    assert.equal(api.calls.length,0);
  }
});
test('checkout webhooks validate session mode before contacting Stripe',()=>{
  for(const env of [testEnv,liveEnv]) {
    const api=runtime(env),live=env.STRIPE_MODE==='live',prefix=live?'live':'test';
    const event={livemode:live,type:'checkout.session.completed',data:{object:{id:`cs_${prefix}_fixture123`}}};
    assert.equal(webhook(api,event).status,200);
    assert.equal(api.calls.length,1);
    assert.equal(api.calls[0].url,`https://api.stripe.com/v1/checkout/sessions/cs_${prefix}_fixture123`);
    for(const id of [`cs_${live?'test':'live'}_fixture123`,'cs_live_bad/path','',null]) {
      assert.throws(()=>webhook(api,{...event,data:{object:{id}}}),error=>error.status===400);
    }
    assert.equal(api.calls.length,1);
  }
});
test('provider objects with the wrong mode cannot fulfill or refund orders',()=>{
  for(const env of [testEnv,liveEnv]) {
    const {settings}=runtime(env),live=env.STRIPE_MODE==='live';
    settings.assertMode({livemode:live});
    for(const object of [{livemode:!live},{},null])assert.throws(()=>settings.assertMode(object),error=>error.status===502);
  }
});
