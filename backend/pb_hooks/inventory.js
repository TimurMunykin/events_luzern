// Call inside the same transaction that creates a reservation or changes capacity.
exports.counts=function(app,slug) {
  var row=new DynamicModel({paid:0,held:0,reserved:0});
  app.db().newQuery("SELECT COALESCE(SUM(CASE WHEN status IN ('paid','partially_refunded') THEN MAX(0,quantity-(SELECT COUNT(*) FROM tickets t WHERE t.\"order\"=orders.id AND t.refunded_at!='')) ELSE 0 END),0) AS paid, COALESCE(SUM(CASE WHEN status='pending' THEN quantity ELSE 0 END),0) AS held, COALESCE(SUM(CASE WHEN status='reserved' AND payment_source='offline' THEN quantity ELSE 0 END),0) AS reserved FROM orders WHERE event_id={:slug}")
    .bind({slug:slug}).one(row);
  return {paid:row.paid,held:row.held,reserved:row.reserved};
};
exports.availability=function(app,event) {
  var counts=exports.counts(app,event.getString('slug')),capacity=event.getInt('capacity');
  return {capacity:capacity,paid:counts.paid,held:counts.held,reserved:counts.reserved,remaining:capacity?Math.max(0,capacity-counts.paid-counts.held-counts.reserved):null,
    sold_out:capacity>0 && counts.paid+counts.reserved>=capacity};
};
