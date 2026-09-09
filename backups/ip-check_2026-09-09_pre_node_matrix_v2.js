(()=>{
  const ipInput=document.getElementById("ip");
  const nodeSelect=document.getElementById("node_name");
  const box=document.getElementById("ipCheck");
  const requestForm=document.getElementById("requestForm");
  const submitBtn=document.getElementById("submitBtn");
  if(!ipInput||!nodeSelect||!box||!requestForm||!submitBtn)return;

  const nodeNames={
    vicidial43:"VICIDIAL 43",VicidialMED:"VICIDIAL MED",
    AliadosD1:"ALIADOS D1",AliadosD2:"ALIADOS D2",AliadosD3:"ALIADOS D3",AliadosD4:"ALIADOS D4",AliadosD5:"ALIADOS D5",
    "ViciIntelya-Dial1":"GENERADORES D1",generadoresmed2:"GENERADORES D2","ViciMED-Dial3":"GENERADORES D3","ViciIntelya-Dial4":"GENERADORES D4","ViciMED-Dial5":"GENERADORES D5"
  };

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
  function clearBox(){
    box.className="ip-check";
    box.innerHTML="";
    lastState=null;
    setIVRLock(false);
  }
  function paint(type,title,detail){
    box.className="ip-check show "+type;
    box.innerHTML='<div class="ip-check-title">'+esc(title)+'</div><div class="ip-check-detail">'+esc(detail)+'</div>';
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
      const missing=Array.isArray(d.missing_nodes)?d.missing_nodes:[];
      const complete=d.coverage_complete===true;
      const allFound=complete&&expected.length>0&&found.length===expected.length;
      const partial=found.length>0&&!allFound;
      const specificNode=expected.length===1;

      lastState={key:ip+"|"+target,allFound,partial,complete,specificNode,found,expected,missing,data:d};

      if(allFound){
        if(specificNode)setIVRLock(true);
        paint("block","La IP ya existe en el IVR","Detectada en todos los nodos del destino: "+joinNodes(found)+". No es necesario generar otra solicitud.");
      }else if(partial){
        setIVRLock(false);
        let detail="Detectada en: "+joinNodes(found)+".";
        if(missing.length)detail+=" Inventario incompleto; faltan: "+joinNodes(missing)+".";
        else detail+=" No está registrada en todos los nodos del destino.";
        paint("warning","La IP ya existe parcialmente",detail);
      }else if(!complete||d.result==="UNKNOWN"){
        setIVRLock(false);
        paint("warning","Inventario incompleto","No se puede confirmar que la IP sea nueva. Faltan inventarios de: "+(joinNodes(missing)||"uno o más nodos")+".");
      }else{
        setIVRLock(false);
        paint("ok","IP no encontrada en el inventario IVR","Cobertura completa para el destino seleccionado. Puedes continuar con la solicitud.");
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
    if(!document.getElementById("appPage").hidden){
      bypassSubmit=true;
      requestForm.requestSubmit();
    }
  },true);
})();
