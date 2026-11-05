"use client";
import { useActionState, useState } from "react";
import { previewImport,commitImport,type ImportResult } from "./actions";
const initial:ImportResult={ok:false,message:"",valid:0,invalid:0,duplicates:0,imported:0,preview:[]};
export function ImportForm({eventId,dates}:{eventId:string;dates:{id:string;label:string}[]}){
 const [preview,previewAction,previewPending]=useActionState(previewImport,initial);
 const [result,commitAction,commitPending]=useActionState(commitImport,initial);
 const [file,setFile]=useState<File|null>(null);
 const [dateId,setDateId]=useState(dates[0]?.id??"");
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 async function submit(action:(fd:FormData)=>void){
  if(!file||!dateId)return;
  const fd=new FormData();fd.set("eventId",eventId);fd.set("dateId",dateId);fd.set("file",file);
  action(fd);
 }
 return <div className="space-y-5">
  <div className="grid gap-4 sm:grid-cols-2">
   <label className="space-y-2 text-sm font-medium">Fecha del evento
    <select className="input" value={dateId} onChange={e=>{setDateId(e.target.value);setConfirmed(false)}}>{dates.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>
   </label>
   <label className="space-y-2 text-sm font-medium">Archivo Excel (.xlsx, máximo 3 MB)
    <input className="input" type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]??null);setConfirmed(false)}}/>
   </label>
  </div>
  <p className="text-sm text-slate-600">La primera fila debe contener los encabezados. Se reconocen automáticamente nombres alternativos de Nombre, DNI/Documento, Correo, Celular, Empresa, Cargo y Acompañante. El correo y celular son obligatorios para completar la inscripción.</p>
  <button type="button" disabled={!file||!dateId||previewPending||busy} className="btn-dark" onClick={()=>{setConfirmed(true);void submit(previewAction)}}>{previewPending?"Analizando…":"Analizar Excel y mostrar vista previa"}</button>
  {confirmed&&preview.message&&<div className="space-y-3"><p role="status" className="text-sm">{preview.message}</p>
   {preview.ok&&<><p className="text-sm font-semibold">Válidos: {preview.valid} · Con errores: {preview.invalid} · Ya registrados: {preview.duplicates}</p>
    <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Fila</th><th>Nombre</th><th>Documento</th><th>Resultado</th></tr></thead><tbody>{preview.preview.map(r=><tr key={r.line} className="border-t"><td className="p-2">{r.line}</td><td className="p-2">{r.name}</td><td className="p-2">{r.document}</td><td className="p-2">{r.errors.join("; ")||"Válido"}</td></tr>)}</tbody></table></div>
    {preview.valid>0&&<button type="button" className="btn-brand" disabled={commitPending||busy} onClick={()=>{setBusy(true);void submit(commitAction)}}>{commitPending?"Importando…":"Confirmar importación de filas válidas"}</button>}
   </>}
  </div>}
  {result.message&&<p role="status" className="text-sm font-medium">{result.message} {result.ok&&`Importados: ${result.imported}. Duplicados: ${result.duplicates}.`}</p>}
 </div>;
}
