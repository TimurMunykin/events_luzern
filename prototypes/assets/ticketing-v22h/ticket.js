'use strict';
window.EventsTicket=(()=>{
  const presentation=window.EventsTicketPresentation;
  function ticketURL(value){
    const url=new URL(value,location.href);
    if(url.origin!==location.origin || !/^\/ticket\/[a-zA-Z0-9]{40}$/.test(url.pathname))throw new Error('Invalid ticket URL');
    return url.origin+url.pathname;
  }
  async function read(value){
    const url=ticketURL(value),response=await fetch(url.replace('/ticket/','/api/events/tickets/'),{cache:'no-store'});
    if(!response.ok)throw new Error('Ticket unavailable');
    return {...await response.json(),url};
  }
  function compact(data){
    const m=presentation.model(data),c=m.copy,e=presentation.escape;
    return (!m.refunded?`<div class="ticket-actions compact-actions"><a data-ticket-pdf href="${e(m.api)}/ticket.pdf">${c.pdf}</a><a data-ticket-calendar href="${e(m.api)}/calendar.ics">${c.calendar}</a></div>`:'')+
      `<article class="compact-ticket" aria-label="${e(c.ticket+' № '+m.number)}">
      <div class="compact-brand"><img src="/assets/logo.png" alt="Events.Luzern" width="36" height="36"><span>${c.ticket} № ${e(m.number)}</span></div>
      <h2>${e(m.event.name)}</h2><p class="compact-name">${e(m.name)}</p>
      <div class="compact-info"><p><strong>${e(m.time)}</strong><br>${e(m.event.venue)}<br><a href="${e(m.map)}" target="_blank" rel="noopener noreferrer">${e(m.event.address)}</a></p>
      ${[m.entry,m.bring].filter(Boolean).map(value=>'<p>'+e(value).replace(/\n/g,'<br>')+'</p>').join('')}</div>
      ${m.refunded?`<p class="ticket-invalid" role="status">${c.refunded}</p>`:`<div class="compact-qr"><img src="${e(m.api)}/qr.gif" width="176" height="176" alt="QR"><span>№ ${e(m.number)}</span></div><p class="compact-admission">${c.show}${m.checkedIn?'<br>'+c.used:''}</p>`}
      <footer><a href="mailto:info@events-luzern.ch">info@events-luzern.ch</a><span>@events.luzern</span></footer></article>`;
  }
  async function mount(root,url,fallbackLanguage='ru',small=false){
    let copy=presentation.copy(fallbackLanguage,1);
    try{
      const data=await read(url);copy=presentation.copy(data.language,1);
      root.innerHTML=small?compact(data):presentation.render(data);
      return data;
    }catch(_){
      root.replaceChildren();const box=document.createElement('div');box.className='ticket-load-error';
      const message=document.createElement('p');message.setAttribute('role','status');message.textContent=copy.missing;
      const retry=document.createElement('button');retry.type='button';retry.textContent=copy.retry;
      retry.onclick=()=>mount(root,url,fallbackLanguage,small);
      box.append(message,retry);root.append(box);return null;
    }
  }
  async function mountAll(root,tickets,language){
    root.replaceChildren();
    await Promise.all(tickets.map(ticket=>{
      const item=document.createElement('section');item.className='ticket-item';root.append(item);
      return mount(item,ticket.url,language);
    }));
  }
  async function mountGallery(root,tickets,language){
    root.replaceChildren();
    const labels={ru:{guest:'Билет гостьи',previous:'Предыдущий билет',next:'Следующий билет'},de:{guest:'Ticket des Gastes',previous:'Vorheriges Ticket',next:'Nächstes Ticket'},en:{guest:'Guest ticket',previous:'Previous ticket',next:'Next ticket'}}[language] || {guest:'Guest ticket',previous:'Previous ticket',next:'Next ticket'};
    const controls=document.createElement('nav');controls.className='ticket-switcher';controls.setAttribute('aria-label',labels.guest);controls.hidden=tickets.length<2;
    const previous=document.createElement('button'),next=document.createElement('button'),select=document.createElement('select'),item=document.createElement('section');
    previous.type=next.type='button';previous.textContent='←';next.textContent='→';
    previous.setAttribute('aria-label',labels.previous);next.setAttribute('aria-label',labels.next);select.setAttribute('aria-label',labels.guest);
    tickets.forEach((ticket,index)=>{const option=document.createElement('option');option.value=index;option.textContent=`${index+1} / ${tickets.length} · № ${ticket.number} · ${ticket.name}`;select.append(option);});
    controls.append(previous,select,next);item.className='ticket-item';root.append(controls,item);
    let index=0,run=0;
    const show=async()=>{
      const current=++run,buffer=document.createElement('div');
      select.value=String(index);previous.disabled=index===0;next.disabled=index===tickets.length-1;
      item.setAttribute('aria-busy','true');item.replaceChildren();
      if(tickets[index])await mount(buffer,tickets[index].url,language,true);
      if(current===run){item.replaceChildren(buffer);item.removeAttribute('aria-busy');}
    };
    select.onchange=()=>{index=Number(select.value);show();};
    previous.onclick=()=>{if(index>0){index--;show();}};next.onclick=()=>{if(index<tickets.length-1){index++;show();}};
    await show();
  }
  return {mount,mountAll,mountGallery};
})();
