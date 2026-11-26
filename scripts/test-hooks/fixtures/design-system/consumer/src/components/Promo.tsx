import { cn } from "../lib/cn";

// Off-system: a raw colour, a hand-rolled radius and shadow.
export function Promo({ wide }: { wide: boolean }) {
  return (
    <section className="p-4 md:rounded-xl" style={{ color: "#ff6600" }}>
      <a className={cn("block", wide && "hover:!shadow-lg")} href="#top">Sale</a>
    </section>
  );
}
