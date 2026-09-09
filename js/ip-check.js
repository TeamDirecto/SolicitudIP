(()=>{
  const ipInput=document.getElementById("ip");
  const requesterInput=document.getElementById("requester");
  const nodeSelect=document.getElementById("node_name");
  const box=document.getElementById("ipCheck");
  const requestForm=document.getElementById("requestForm");
  const submitBtn=document.getElementById("submitBtn");
  if(!ipInput||!requesterInput||!nodeSelect||!box||!requestForm||!submitBtn)return;

  const nodeNames={
    vicidial43:"VICIDIAL 43",VicidialMED:"VICIDIAL MED",
    AliadosD1:"ALIADOS D1",AliadosD2:"ALIADOS D2",AliadosD3:"ALIADOS D3",AliadosD4:"ALIADOS D4",AliadosD5:"ALIADOS D5",
    "ViciIntelya-Dial1":"GENERADORES D1",generadoresmed2:"GENERADORES D2","ViciMED-Dial3":"GENERADORES D3","ViciIntelya-Dial4":"GENERADORES D4","ViciMED-Dial5":"GENERADORES D5"
  };
  const aliados=["AliadosD1","AliadosD2","AliadosD3","AliadosD4","AliadosD5"];
  const generadores=["ViciIntelya-Dial1","generadoresmed2","ViciMED-Dial3","ViciIntelya-Dial4","ViciMED-Dial5"];

  let timer=null,controller=null,seq=0,lastState=null,bypassSubmit=false;

  function labelNode(n){return nodeNames[n]||n}
  function joinNodes(nodes){return (nodes||[]).map(labelNode).join(", ")}
  function isIPv4(v){
    const p=String(v||"").trim().split(".");
    return p.length===4&&p.every(x=>/^\d+$/.test(x)&&Number(x)>=0&&Number(x)<=255);
  }

  function setSubmitLock(mode){
    const span=submitBtn.querySelector("span");
    submitBtn.dataset.ipmLock=mode||"";
    if(mode==="exists"){
      submitBtn.disabled=true;
      submitBtn.title="La IP ya está registrada en todo el destino seleccionado";
      if(span)span.textContent="IP ya registrada";
      return;
    }
    if(mode==="unknown"){
      submitBtn.disabled=true;
      submitBtn.title="La verificación no está completa";
      if(span)span.textContent="Validación incompleta";
      return;
    }
    submitBtn.dataset.ipmLock="";
    submitBtn.disabled=false;
    submitBtn.removeAttribute("title");
    if(span)span.textContent="Solicitar acceso";
  }

  function setSending(sending){
    const span=submitBtn.querySelector("span");
    if(sending){
      submitBtn.disabled=true;
      if(span)span.textContent="Enviando faltantes...";
    }else if(!submitBtn.dataset.ipmLock){
      submitBtn.disabled=false;
      if(span)span.textContent="Solicitar acceso";
    }
  }

  function clearBox(){
    box.className="ip-check";
    box.innerHTML="";
    lastState=null;
    setSubmitLock("");
  }

  function sourceMeta(source,node,d){
    const health=(d.node_health_state&&d.node_health_state[node])||"UNKNOWN";
    const staleFound=new Set(Array.isArray(d.ivr_stale_found_nodes)?d.ivr_stale_found_nodes:[]);
    if(source==="BOTH")return {cls:health==="SYNCED"?"both":"both healthbad",icon:"✓",status:"IVR + IP Manager"+(health!=="SYNCED"?" · "+health:"")};
    if(source==="IP_MANAGER")return {cls:health==="SYNCED"?"ipmanager":"ipmanager healthbad",icon:"◆",status:"IP Manager"+(health!=="SYNCED"?" · "+health:"")};
    if(source==="IVR_LEGACY")return {cls:"legacy",icon:"✓",status:"IVR legacy"};
    if(source==="NEW")return {cls:"new",icon:"✕",status:"Nueva"};
    if(staleFound.has(node))return {cls:"unknown",icon:"⚠",status:"IVR desactualizado"};
    return {cls:"unknown",icon:"?",status:"Sin confirmar"};
  }

  function nodeMatrix(d){
    const expected=Array.isArray(d.expected_nodes)?d.expected_nodes:[];
    if(!expected.length)return "";
    const sources=d.node_sources||{};

    const rows=expected.map(node=>{
      let source=sources[node];
      if(!source){
        const found=new Set(Array.isArray(d.found_nodes)?d.found_nodes:[]);
        const stale=new Set(Array.isArray(d.stale_nodes)?d.stale_nodes:[]);
        const missing=new Set(Array.isArray(d.missing_nodes)?d.missing_nodes:[]);
        source=found.has(node)?"IVR_LEGACY":(stale.has(node)||missing.has(node)?"UNKNOWN":"NEW");
      }
      const meta=sourceMeta(source,node,d);
      return '<div class="ip-node '+meta.cls+'"><span class="ip-node-icon">'+meta.icon+'</span><span class="ip-node-name">'+esc(labelNode(node))+'</span><span class="ip-node-status">'+esc(meta.status)+'</span></div>';
    }).join("");

    return '<div class="ip-node-grid">'+rows+'</div>';
  }

  function paint(type,title,detail,data){
    box.className="ip-check show "+type;
    box.innerHTML='<div class="ip-check-title">'+esc(title)+'</div><div class="ip-check-detail">'+esc(detail)+'</div>'+(data?nodeMatrix(data):"");
  }

  function requestTargets(selected,requestable){
    const missing=Array.isArray(requestable)?requestable:[];
    const targets=[];
    const addDirect=n=>targets.push({node_name:n,destination:labelNode(n)});

    if(selected==="ALIADOS"||selected==="GENERADORES"){
      missing.forEach(addDirect);
      return targets;
    }
    if(selected!=="ALL_CENTERS")return targets;

    if(missing.includes("vicidial43"))addDirect("vicidial43");
    if(missing.includes("VicidialMED"))addDirect("VicidialMED");

    const missingAliados=aliados.filter(n=>missing.includes(n));
    if(missingAliados.length===aliados.length)targets.push({node_name:"ALIADOS",destination:"ALIADOS"});
    else missingAliados.forEach(addDirect);

    const missingGeneradores=generadores.filter(n=>missing.includes(n));
    if(missingGeneradores.length===generadores.length)targets.push({node_name:"GENERADORES",destination:"GENERADORES"});
    else missingGeneradores.forEach(addDirect);

    return targets;
  }

  async function runCheck(){
    const ip=ipInput.value.trim();
    const target=nodeSelect.value;
    if(!isIPv4(ip)||!target){clearBox();return null}

    const mySeq=++seq;
    if(controller)controller.abort();
    controller=new AbortController();
    setSubmitLock("");
    paint("checking","Verificando IP…","Consultando IVR legacy e IP Manager.");

    try{
      const url=API+"/ip-check?ip="+encodeURIComponent(ip)+"&node_name="+encodeURIComponent(target);
      const r=await apiFetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:controller.signal});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){
        let detail=d.detail||("HTTP "+r.status);
        if(typeof detail==="object")detail=JSON.stringify(detail);
        throw new Error(detail);
      }
      if(mySeq!==seq)return null;

      const expected=Array.isArray(d.expected_nodes)?d.expected_nodes:[];
      const present=Array.isArray(d.present_nodes)?d.present_nodes:(Array.isArray(d.found_nodes)?d.found_nodes:[]);
      const requestable=Array.isArray(d.requestable_nodes)?d.requestable_nodes:expected.filter(n=>!present.includes(n));
      const unknown=Array.isArray(d.unknown_nodes)?d.unknown_nodes:[];
      const allPresent=d.all_present===true||(expected.length>0&&present.length===expected.length);
      const safe=d.safe_to_submit!==false&&unknown.length===0;
      const partial=present.length>0&&!allPresent;

      lastState={key:ip+"|"+target,expected,present,requestable,unknown,allPresent,safe,partial,data:d};

      if(allPresent){
        setSubmitLock("exists");
        paint("block","La IP ya está registrada","Existe en todos los nodos del destino seleccionado, ya sea por IVR legacy, IP Manager o ambos.",d);
      }else if(!safe){
        setSubmitLock("unknown");
        paint("warning","Validación incompleta","No es seguro determinar todos los nodos faltantes. Sin confirmar: "+(joinNodes(unknown)||"uno o más nodos")+".",d);
      }else if(partial){
        setSubmitLock("");
        paint("warning","La IP ya existe parcialmente","Registrada en "+present.length+" de "+expected.length+" nodos. Se solicitará únicamente acceso para los "+requestable.length+" nodos nuevos.",d);
      }else{
        setSubmitLock("");
        paint("ok","IP disponible para solicitud","No aparece en IVR legacy ni en IP Manager para el destino seleccionado.",d);
      }
      return lastState;
    }catch(err){
      if(err&&err.name==="AbortError")return null;
      if(err&&err.message==="AUTH")return null;
      if(mySeq!==seq)return null;
      lastState={key:ip+"|"+target,error:true,safe:false};
      setSubmitLock("unknown");
      paint("warning","No fue posible verificar la IP",err&&err.message?err.message:"Error consultando el estado de la IP.");
      return lastState;
    }
  }

  function schedule(){
    if(timer)clearTimeout(timer);
    setSubmitLock("");
    const ip=ipInput.value.trim(),target=nodeSelect.value;
    if(!isIPv4(ip)||!target){clearBox();return}
    paint("checking","Verificando IP…","Consultando IVR legacy e IP Manager.");
    timer=setTimeout(()=>runCheck(),450);
  }

  async function submitMissingOnly(result){
    const selected=nodeSelect.value;
    const ip=ipInput.value.trim();
    const requester=requesterInput.value.trim();
    const targets=requestTargets(selected,result.requestable);
    if(!targets.length)return false;

    setSending(true);
    message.className="message";

    try{
      const results=[];
      for(const target of targets){
        const payload={ip,requester,node_name:target.node_name};
        try{
          const d=await create(payload);
          remember({id:d.id,ip:d.ip||ip,requester,node_name:payload.node_name,destination:target.destination,status:d.status||"PENDING",created_at:d.created_at||new Date().toISOString()});
          results.push({type:"created",destination:target.destination,id:d.id});
        }catch(err){
          if(err.message==="AUTH")throw err;
          results.push({type:err.status===409?"duplicate":"error",destination:target.destination});
        }
      }

      const created=results.filter(r=>r.type==="created");
      const duplicates=results.filter(r=>r.type==="duplicate");
      const errors=results.filter(r=>r.type==="error");
      const parts=[];
      created.forEach(r=>parts.push(r.destination+": folio #"+r.id));
      duplicates.forEach(r=>parts.push(r.destination+": ya existe"));
      errors.forEach(r=>parts.push(r.destination+": error"));

      if(errors.length)show("error","Solicitud procesada parcialmente. "+parts.join(" | "));
      else{
        show("success","Se solicitaron únicamente los nodos faltantes. "+parts.join(" | "));
        requestForm.reset();
      }
      await refresh();
      return true;
    }catch(err){
      if(err.message!=="AUTH")show("error",err.message||"No fue posible procesar los nodos faltantes.");
      return true;
    }finally{
      setSending(false);
    }
  }

  ipInput.addEventListener("input",schedule);
  nodeSelect.addEventListener("change",schedule);
  requestForm.addEventListener("reset",()=>setTimeout(clearBox,0));

  requestForm.addEventListener("submit",async e=>{
    if(bypassSubmit){bypassSubmit=false;return}
    e.preventDefault();
    e.stopImmediatePropagation();

    const result=await runCheck();
    if(!result||result.error||!result.safe){
      show("error","La validación no está completa; la solicitud no fue enviada.");
      return;
    }
    if(result.allPresent){
      show("error","La IP ya está registrada en todos los nodos del destino seleccionado; la solicitud no fue enviada.");
      return;
    }

    const selected=nodeSelect.value;
    const grouped=selected==="ALIADOS"||selected==="GENERADORES"||selected==="ALL_CENTERS";
    if(grouped&&result.partial){
      await submitMissingOnly(result);
      return;
    }

    if(!document.getElementById("appPage").hidden){
      bypassSubmit=true;
      requestForm.requestSubmit();
    }
  },true);
})();
