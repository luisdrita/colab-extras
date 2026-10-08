// A self-contained Material-style ring that inherits Colab's theme colours.
// Shadow DOM prevents notebook or page styles from changing its geometry.
function createProgress(label){
  const element=document.createElement('span');element.dataset.cfzProgress='';
  element.setAttribute('role','progressbar');element.setAttribute('aria-valuemin','0');element.setAttribute('aria-valuemax','100');
  const shadow=element.attachShadow({mode:'open'});
  const style=document.createElement('style');style.textContent=`
    :host{display:inline-flex;width:18px;height:18px;flex:0 0 18px;vertical-align:middle;color:var(--colab-primary-color,#1a73e8)}
    svg{display:block;width:100%;height:100%;overflow:visible;transform:rotate(-90deg)}
    circle{fill:none;stroke:currentColor;stroke-width:2;transform-origin:center}
    .track{opacity:.18}.arc{stroke-linecap:round;stroke-dasharray:100;transition:stroke-dashoffset .18s linear}
    :host([data-indeterminate]) svg{animation:cfz-rotate 1.4s linear infinite}
    :host([data-indeterminate]) .track{opacity:0}
    :host([data-indeterminate]) .arc{animation:cfz-sweep 1.4s ease-in-out infinite;transition:none}
    @keyframes cfz-rotate{to{transform:rotate(270deg)}}
    @keyframes cfz-sweep{0%{stroke-dasharray:8 100;stroke-dashoffset:0}50%{stroke-dasharray:72 100;stroke-dashoffset:-20}100%{stroke-dasharray:8 100;stroke-dashoffset:-100}}
    @media(prefers-reduced-motion:reduce){svg,.arc{animation:none!important}.arc{transition:none}:host([data-indeterminate]) .arc{stroke-dasharray:65 100}}
  `;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');
  for(const name of ['track','arc']){
    const circle=document.createElementNS(svg.namespaceURI,'circle');
    for(const [key,value] of Object.entries({class:name,cx:'10',cy:'10',r:'8',pathLength:'100'}))circle.setAttribute(key,value);
    svg.append(circle);
  }
  shadow.append(style,svg);
  const arc=svg.lastElementChild;
  const update=(label,fraction=null)=>{
    const known=typeof fraction==='number'&&Number.isFinite(fraction);
    const percent=known?Math.round(Math.min(1,Math.max(0,fraction))*100):null;
    element.setAttribute('aria-label',label);element.setAttribute('aria-valuetext',label);
    element.toggleAttribute('data-indeterminate',!known);
    if(known){element.setAttribute('aria-valuenow',String(percent));arc.style.strokeDashoffset=String(100-percent);}
    else{element.removeAttribute('aria-valuenow');arc.style.removeProperty('stroke-dashoffset');}
  };
  update(label);return {element,update};
}
