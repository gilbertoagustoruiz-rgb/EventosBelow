"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <input {...props} type={visible ? "text" : "password"} className="input pr-14" />
    <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible} aria-controls={props.id} className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">{visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button>
  </div>;
}
