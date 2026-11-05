"use server";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { requireEvent } from "@/lib/auth";
import { query, transaction, pgMessage } from "@/lib/db";
import { registrationSchema } from "@/lib/validation";

type Row = { line:number; name:string; email:string; phone:string; documentType:string; document:string; company:string; jobTitle:string; companionName:string; companionType:string; companionDocument:string; errors:string[] };
export type ImportResult = { ok:boolean; message:string; valid:number; invalid:number; duplicates:number; imported:number; preview:Row[] };
const empty=(message:string):ImportResult=>({ok:false,message,valid:0,invalid:0,duplicates:0,imported:0,preview:[]});
const aliases:Record<string,string[]>={
 name:["nombre","nombres","nombre completo","nombres y apellidos","apellidos y nombres","asistente","full name"],
 email:["correo","correo electronico","email","e mail","mail"],
 phone:["celular","telefono","movil","numero celular","phone"],
 document:["dni","documento","numero documento","nro documento","numero de documento","document number","cedula"],
 documentType:["tipo documento","tipo de documento","tipo doc"],
 company:["empresa","organizacion","compania","company"],
 jobTitle:["cargo","puesto","job title"],
 companionName:["acompanante","nombre acompanante","nombre del acompanante"],
 companionType:["tipo documento acompanante","tipo doc acompanante"],
 companionDocument:["documento acompanante","dni acompanante"]
};
const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[_\-./]+/g," ").replace(/\s+/g," ").trim();
function cell(v:ExcelJS.CellValue):string {
 if(v==null)return "";
 if(typeof v==="object"){
  if("text" in v)return String(v.text??"").trim();
  if("result" in v)return String(v.result??"").trim();
  if("richText" in v)return v.richText.map(x=>x.text).join("").trim();
  return "";
 }
 return String(v).trim();
}
async function parse(fd:FormData){
 const eventId=String(fd.get("eventId")??"");
 const dateId=String(fd.get("dateId")??"");
 await requireEvent(eventId,"admin");
 const dates=await query<{id:string;capacity:number;registered_count:number}>("select id,capacity,registered_count from event_dates where id=$1 and event_id=$2",[dateId,eventId]);
 if(!dates.length)throw Error("Selecciona una fecha válida del evento.");
 const file=fd.get("file");
 if(!(file instanceof File)||file.size===0||file.size>3*1024*1024||!(/\.xlsx$/i).test(file.name))throw Error("Adjunta un Excel .xlsx de máximo 3 MB.");
 const book=new ExcelJS.Workbook();
 await book.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
 const sheet=book.worksheets[0];
 if(!sheet||sheet.rowCount<2)throw Error("El archivo no contiene registros.");
 const headers=sheet.getRow(1).values as ExcelJS.CellValue[];
 const mapping:Record<string,number>={};
 for(const [key,options] of Object.entries(aliases)){
  const ix=headers.findIndex((v,i)=>i>0&&options.includes(normalize(cell(v))));
  if(ix>0)mapping[key]=ix;
 }
 if(!mapping.name||!mapping.document)throw Error("No se identificaron las columnas Nombre y Documento/DNI en la primera fila.");
 if(sheet.rowCount>2001)throw Error("Máximo 2,000 filas por archivo.");
 const rows:Row[]=[];
 const seen=new Set<string>();
 for(let i=2;i<=sheet.rowCount;i++){
  const row=sheet.getRow(i);
  const get=(key:string)=>mapping[key]?cell(row.getCell(mapping[key]).value):"";
  const name=get("name"),document=get("document").toUpperCase().replace(/[\s.-]/g,"");
  if(!name&&!document)continue;
  const documentType=(get("documentType")||(/^[0-9]{8}$/.test(document)?"DNI":"CE")).toUpperCase();
  const companionName=get("companionName"),companionDocument=get("companionDocument");
  const input={eventDateId:dateId,fullName:name,email:get("email"),phone:get("phone"),documentType,documentNumber:document,company:get("company"),jobTitle:get("jobTitle"),hasCompanion:!!companionName,companionFullName:companionName,companionDocumentType:get("companionType")||"DNI",companionDocumentNumber:companionDocument};
  const validation=registrationSchema.safeParse(input);
  const errors=validation.success?[]:validation.error.issues.map(e=>e.message);
  const unique=documentType+":"+document;
  if(seen.has(unique))errors.push("Documento duplicado dentro del Excel");
  seen.add(unique);
  rows.push({line:i,name,email:get("email"),phone:get("phone"),documentType,document,company:get("company"),jobTitle:get("jobTitle"),companionName,companionType:get("companionType")||"DNI",companionDocument,errors});
 }
 return {eventId,dateId,date:dates[0],rows};
}
export async function previewImport(_:ImportResult,fd:FormData):Promise<ImportResult>{
 try{
  const {eventId,dateId,date,rows}=await parse(fd);
  const existing=await query<{document_type:string;document_number:string}>("select document_type,document_number from registrations where event_id=$1 and event_date_id=$2 and status<>'CANCELADO'",[eventId,dateId]);
  const used=new Set(existing.map(r=>r.document_type+":"+r.document_number));
  let duplicates=0;
  for(const row of rows)if(used.has(row.documentType+":"+row.document)){row.errors.push("Ya inscrito en esta fecha");duplicates++;}
  const valid=rows.filter(r=>!r.errors.length).length;
  const seats=rows.filter(r=>!r.errors.length).reduce((n,r)=>n+(r.companionName?2:1),0);
  return {ok:true,message:seats>date.capacity-date.registered_count?"Atención: los cupos disponibles no alcanzan para todos los registros válidos.":"Vista previa lista. Confirma para importar solo filas válidas.",valid,invalid:rows.length-valid,duplicates,imported:0,preview:rows.slice(0,100)};
 }catch(e){return empty(e instanceof Error?e.message:"No se pudo leer el Excel.");}
}
export async function commitImport(_:ImportResult,fd:FormData):Promise<ImportResult>{
 try{
  const {eventId,dateId,rows}=await parse(fd);
  let imported=0,duplicates=0,invalid=rows.filter(r=>r.errors.length).length;
  // Cada registro utiliza la función de inscripción de PostgreSQL, que controla aforo y duplicados.
  // La transacción hace que un fallo inesperado no deje una importación parcial.
  await transaction(async client=>{
   for(const r of rows){
    if(r.errors.length)continue;
    try{
     await client.query("SAVEPOINT import_row");
     await client.query("select out_token from register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[
      dateId,r.name,r.email,r.phone,r.documentType,r.document,r.company||null,r.jobTitle||null,
      !!r.companionName,r.companionName||null,r.companionName?r.companionType:null,r.companionDocument||null
     ]);
     await client.query("RELEASE SAVEPOINT import_row");
     imported++;
    }catch(e){
     await client.query("ROLLBACK TO SAVEPOINT import_row");
     await client.query("RELEASE SAVEPOINT import_row");
     const message=pgMessage(e);
     if(message.includes("DUPLICATE"))duplicates++;
     else if(message.includes("SOLD_OUT"))throw Error("Aforo insuficiente. No se importó ninguna fila.");
     else throw e;
    }
   }
  });
  revalidatePath("/admin/eventos/"+eventId);
  return {ok:true,message:"Importación completada. Los asistentes importados tienen token QR y aparecen en inscripciones.",valid:imported,invalid,duplicates,imported,preview:[]};
 }catch(e){return empty(e instanceof Error?e.message:"Error al importar. No se confirmaron los cambios.");}
}
