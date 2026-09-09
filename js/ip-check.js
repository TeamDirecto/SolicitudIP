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
  function setIVRLock(locked){
    const span=submitBtn.querySelector("span");
    if(locked){
      submitBtn.dataset.ivrBlocked="1";
      submitBtn.disabled=true;
      submitBtn.title="La IP ya existe en el nodo seleccionado";
      if(span)span.textContent="IP ya registrada";
      return;
    }
    if(submitBtn.dataset.ivrBlocked==="1"){
      submitBtn.dataset.ivrBlocked="0";
      submitBtn.disabled=false;
      submitBtn.removeAttribute("title");
      if(span)span.textContent="Solicitar acceso";
    }
  }
  function setSending(sending){
    const span=submitBtn.querySelector("span");
    if(sending){
      submitBtn.disabled=true;
      if(span)span.textContent="Enviando faltantes...";
    }else if(submitBtn.dataset.ivrBlocked!=="1"){
      submitBtn.disabled=false;
      if(span)span.textContent="Solicitar acceso";
    }
  }
  function clearBox(){
    box.className="ip-check";
    box.innerHTML="";
    lastState=null;
    setIVRLock(false);
  }
  function nodeMatrix(d){
    const expected=Array.isArray(d.expected_nodes)?d.expected_nodes:[];
    if(!expected.length)return "";

    const found=new Set(Array.isArray(d.found_nodes)?d.found_nodes:[]);
    const staleFound=new Set(Array.isArray(d.stale_found_nodes)?d.stale_found_nodes:[]);
    const stale=new Set(Array.isArray(d.stale_nodes)?d.stale_nodes:[]);
    const missing=new Set(Array.isArray(d.missing_nodes)?d.missing_nodes:[]);
    const fresh=new Set(Array.isArray(d.fresh_nodes)?d.fresh_nodes:[]);

    const rows=expected.map(node=>{
      let cls="notfound",icon="✕",status="No existe";
      if(missing.has(node)){
        cls="unknown";icon="?";status="Sin inventario";
      }else if(stale.has(node)){
        cls="stale";icon="⚠";status=staleFound.has(node)?"Existe · inventario desactualizado":"Inventario desactualizado";
      }else if(found.has(node)){
        cls="found";icon="✓";status="Ya existe";
      }else if(!fresh.has(node)&&d.coverage_complete!==true){
        cls="unknown";icon="?";status="Sin confirmar";
      }
      return '<div class="ip-node '+cls+'"><span class="ip-node-icon">'+icon+'</span><span class="ip-node-name">'+esc(labelNode(node))+'</span><span class="ip-node-status">'+esc(status)+'</span></div>';
    }).join("");

    return '<div class="ip-node-grid">'+rows+'</div>';
  }
  function paint(type,title,detail,data){
    box.className="ip-check show "+type;
    box.innerHTML='<div class="ip-check-title">'+esc(title)+'</div><div class="ip-check-detail">'+esc(detail)+'</div>'+(data?nodeMatrix(data):"");
  }

  function missingRequestTargets(selected,expected,found){
    const foundSet=new Set(found||[]);
    const missing=(expected||[]).filter(n=>!foundSet.has(n));
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
    if(missingAliados.length===aliados.length){
      targets.push({node_name:"ALIADOS",destination:"ALIADOS"});
    }else{
      missingAliados.forEach(addDirect);
    }

    const missingGeneradores=generadores.filter(n=>missing.includes(n));
    if(missingGeneradores.length===generadores.length){
      targets.push({node_name:"GENERADORES",destination:"GENERADORES"});
    }else{
      missingGeneradores.forEach(addDirect);
    }

    return targets;
  }

  async function runCheck(){
    const ip=ipInput.value.trim();
    const target=nodeSelect.value;
    if(!isIPv4(ip)||!target){clearBox();return null}

    const mySeq=++seq;
    if(controller)controller.abort();
    controller=new AbortController();
    setIVRLock(false);
    paint("checking","Verificando IP…","Consultando el inventario IVR del destino seleccionado.");

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
      const found=Array.isArray(d.found_nodes)?d.found_nodes:[];
      const missingInventory=Array.isArray(d.missing_nodes)?d.missing_nodes:[];
      const stale=Array.isArray(d.stale_nodes)?d.stale_nodes:[];
      const complete=d.coverage_complete===true;
      const allFound=complete&&expected.length>0&&found.length===expected.length;
      const partial=found.length>0&&!allFound;
      const specificNode=expected.length===1;
      const requestable=complete?expected.filter(n=>!found.includes(n)):[];

      lastState={key:ip+"|"+target,allFound,partial,complete,specificNode,found,expected,missingInventory,stale,requestable,data:d};

      if(allFound){
        if(specificNode)setIVRLock(true);
        paint("block","La IP ya existe en el IVR","Detectada en todos los nodos del destino. No es necesario generar otra solicitud.",d);
      }else if(!complete||d.result==="UNKNOWN"){
        setIVRLock(false);
        let detail="No se puede confirmar que la IP sea nueva.";
        if(stale.length)detail+=" Inventario desactualizado: "+joinNodes(stale)+".";
        if(missingInventory.length)detail+=" Sin inventario: "+joinNodes(missingInventory)+".";
        paint("warning","Inventario incompleto",detail,d);
      }else if(partial){
        setIVRLock(false);
        paint("warning","La IP ya existe parcialmente","Ya existe en "+found.length+" de "+expected.length+" nodos. Al solicitar, se generará acceso únicamente para los "+requestable.length+" nodos faltantes.",d);
      }else{
        setIVRLock(false);
        paint("ok","IP no encontrada en el inventario IVR","Cobertura completa para el destino seleccionado. Puedes continuar con la solicitud.",d);
      }
      return lastState;
    }catch(err){
      if(err&&err.name==="AbortError")return null;
      if(err&&err.message==="AUTH")return null;
      if(mySeq!==seq)return null;
      setIVRLock(false);
      lastState={key:ip+"|"+target,error:true};
      paint("warning","No fue posible verificar la IP",err&&err.message?err.message:"Error consultando el inventario IVR.");
      return lastState;
    }
  }

  function schedule(){
    if(timer)clearTimeout(timer);
    const ip=ipInput.value.trim(),target=nodeSelect.value;
    setIVRLock(false);
    if(!isIPv4(ip)||!target){clearBox();return}
    paint("checking","Verificando IP…","Consultando el inventario IVR del destino seleccionado.");
    timer=setTimeout(()=>runCheck(),450);
  }

  async function submitMissingOnly(result){
    const selected=nodeSelect.value;
    const ip=ipInput.value.trim();
    const requester=requesterInput.value.trim();
    const targets=missingRequestTargets(selected,result.expected,result.found);

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

      if(errors.length){
        show("error","Solicitud procesada parcialmente. "+parts.join(" | "));
      }else{
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
    if(result&&result.allFound){
      show("error","La IP ya existe en todos los nodos del destino seleccionado; la solicitud no fue enviada.");
      return;
    }

    const selected=nodeSelect.value;
    const grouped=selected==="ALIADOS"||selected==="GENERADORES"||selected==="ALL_CENTERS";

    if(grouped&&(!result||result.error||!result.complete)){
      show("error","No se puede determinar con seguridad qué nodos faltan. La solicitud agrupada no fue enviada; espera a que el inventario vuelva a estar completo.");
      return;
    }

    if(result&&grouped&&result.complete&&result.partial){
      await submitMissingOnly(result);
      return;
    }

    if(!document.getElementById("appPage").hidden){
      bypassSubmit=true;
      requestForm.requestSubmit();
    }
  },true);
})();
