'use strict';
window.EventsTicket=(()=>{
  const presentation=window.EventsTicketPresentation;
  let assetsPromise;
  const binary=buffer=>{
    const bytes=new Uint8Array(buffer);let result='';
    for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(result);
  };
  async function picture(src){
    const image=new Image();image.src=src;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png');
  }
  async function assets(){
    if(!assetsPromise)assetsPromise=(async()=>{
      if(!window.jspdf)await new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='/assets/ticketing-v22c/vendor/jspdf-4.2.1.umd.min.js';
        script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('PDF library unavailable'));};document.head.append(script);
      });
      const files={Inter:'/assets/ticketing-v22c/vendor/Inter.ttf',Oswald:'/assets/ticketing-v22d/vendor/Oswald-SemiBold.ttf'};
      const fonts={};
      await Promise.all(Object.entries(files).map(async([name,url])=>{
        const response=await fetch(url);if(!response.ok)throw new Error('Font unavailable');fonts[name]=binary(await response.arrayBuffer());
      }));
      return {fonts,logo:await picture('/assets/logo.png')};
    })().catch(error=>{assetsPromise=undefined;throw error;});
    return assetsPromise;
  }
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
  async function download(data){
    const m=presentation.model(data),p=presentation.palette,c=m.copy;
    const [bundle,qr]=await Promise.all([assets(),picture(m.api+'/qr.gif')]);
    const width=148,height=264,padding=14;
    const doc=new window.jspdf.jsPDF({unit:'mm',format:[width,height],orientation:'portrait',compress:true});
    for(const [name,font] of Object.entries(bundle.fonts)){
      doc.addFileToVFS(name+'.ttf',font);doc.addFont(name+'.ttf',name,'normal');
    }
    let y;
    const page=()=>{
      doc.setFillColor(p.background);doc.rect(0,0,width,height,'F');
      doc.setFillColor(p.navy);doc.roundedRect(5,5,width-10,height-10,5,5,'F');y=15;
    };
    const room=size=>{if(y+size>height-padding){doc.addPage();page();}};
    const text=(value,{size=10,font='Inter',color=p.cream,gap=4,link}={})=>{
      doc.setFont(font);doc.setFontSize(size);doc.setTextColor(color);
      const lines=doc.splitTextToSize(String(value),width-padding*2),lineHeight=size*.48;
      for(const line of lines){
        room(lineHeight);doc.setFont(font);doc.setFontSize(size);doc.setTextColor(color);
        doc.text(line,width/2,y,{align:'center',baseline:'top'});
        if(link)doc.link(padding,y,width-padding*2,lineHeight,{url:link});
        y+=lineHeight;
      }
      y+=gap;
    };
    page();
    doc.setFont('Inter');doc.setFontSize(9);doc.setTextColor(p.cream);doc.text(c.ticket,padding,y,{baseline:'top'});
    doc.setTextColor(p.gold);doc.text('№ '+m.number,width-padding,y,{align:'right',baseline:'top'});
    doc.addImage(bundle.logo,'PNG',width/2-10,24,20,20);y=48;
    text(m.event.name.toUpperCase(),{size:36,font:'Oswald',color:p.gold,gap:8});
    text(c.guest,{size:9,gap:1});text(m.name.toUpperCase(),{size:15,gap:6});
    text(m.time,{size:11,gap:3});text(m.event.venue,{size:9,gap:1});text(m.event.address,{size:8,gap:7,link:m.map});
    room(79);const qrY=y;
    doc.setFillColor(p.paper);doc.roundedRect(width/2-31,qrY,62,72,4,4,'F');
    doc.addImage(qr,'PNG',width/2-28,qrY+3,56,56);
    doc.link(width/2-31,qrY,62,72,{url:m.url});
    doc.setFont('Inter');doc.setFontSize(11);doc.setTextColor(p.inkGold);
    doc.text('№ '+m.number,width/2,qrY+63,{align:'center',baseline:'top'});y+=78;
    text(c.show,{size:8,gap:1});text(c.admission,{size:8,gap:5});
    if(m.checkedIn)text(c.used,{size:9,color:p.gold});
    for(const [label,value] of [[c.entry,m.entry],[c.bring,m.bring]])if(value){
      room(16);text(label,{size:8,color:p.gold,gap:1});text(value,{size:9,gap:5});
    }
    room(17);text(c.contact,{size:8,gap:1});text('info@events-luzern.ch',{size:8,gap:4,link:'mailto:info@events-luzern.ch'});
    text('@events.luzern',{size:8,color:p.gold,gap:0});
    doc.setProperties({title:m.event.name+' · '+c.title+' № '+m.number,author:'Events.Luzern'});
    doc.save('Events-Luzern-'+m.number+'.pdf');
  }
  function compact(data){
    const m=presentation.model(data),c=m.copy,e=presentation.escape;
    return (!m.refunded?`<div class="ticket-actions compact-actions"><a data-ticket-pdf href="${e(m.url)}#pdf">${c.pdf}</a><a data-ticket-calendar href="${e(m.api)}/calendar.ics">${c.calendar}</a></div>`:'')+
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
      const button=root.querySelector('[data-ticket-pdf]');
      if(button){
        const status=document.createElement('p');status.className='ticket-download-status';status.setAttribute('role','status');root.append(status);
        button.addEventListener('click',async event=>{
          event.preventDefault();if(button.getAttribute('aria-disabled')==='true')return;
          button.setAttribute('aria-disabled','true');button.textContent=copy.loading;status.textContent='';
          try{
            // Re-check before downloading so an old browser tab cannot issue a cancelled ticket.
            const fresh=await read(url);
            if(fresh.status==='refunded'){await mount(root,url,fallbackLanguage,small);return;}
            await download(fresh);
          }catch(_){status.textContent=copy.error;}
          finally{button.removeAttribute('aria-disabled');button.textContent=copy.pdf;}
        });
      }
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
