import { MapPin } from "lucide-react";

export function EventHeader({
  name,
  logoUrl,
  venue,
  description,
}: {
  name: string;
  logoUrl: string | null;
  venue: string | null;
  description?: string | null;
}) {
  return (
    <header className="bg-brand text-brand-fg">
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="mb-6 h-12 w-auto max-w-[200px] rounded-md bg-white/95 object-contain p-1.5" />
        )}
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
        {venue && (
          <p className="mt-2 flex items-center gap-1.5 opacity-90">
            <MapPin className="size-4" />
            {venue}
          </p>
        )}
        {description && <p className="mt-4 max-w-2xl whitespace-pre-line opacity-90">{description}</p>}
      </div>
    </header>
  );
}
