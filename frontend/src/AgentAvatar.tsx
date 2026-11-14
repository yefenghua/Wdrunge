import { useId } from "react";
import { characterAppearance } from "./CharacterAppearance";
import type { DeskRole } from "./DeskScene";

const shade = (color: number) => `rgb(${[16, 8, 0].map(shift => Math.round(((color >> shift) & 255) * .9)).join(",")})`;
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** Small, local vector portraits using the same wardrobe and hair as the office. */
export default function AgentAvatar({ agent, className = "" }: { agent: string; className?: string }) {
  const id = useId();
  const appearance = Object.prototype.hasOwnProperty.call(characterAppearance, agent) ? characterAppearance[agent as DeskRole] : undefined;
  if (!appearance) return <span className={`avatar avatar-user ${className}`} aria-hidden="true">{agent === "user" ? "Y" : "·"}</span>;

  const shirt = hex(appearance.shirt), hair = hex(appearance.hair), skin = hex(appearance.skin);
  const { style } = appearance;
  const hoodie = style === "curly" || style === "headphones";

  return <span className={`avatar agent-avatar ${className}`} aria-hidden="true">
    <svg viewBox="0 0 80 80" fill="none" focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x2="1" y2="1"><stop stopColor="#faf8f3" /><stop offset="1" stopColor={shirt} stopOpacity=".35" /></linearGradient>
        <linearGradient id={`${id}-skin`} x2=".8" y2="1"><stop stopColor={skin} /><stop offset="1" stopColor={shade(appearance.skin)} /></linearGradient>
        <linearGradient id={`${id}-shirt`} x2=".5" y2="1"><stop stopColor={shirt} /><stop offset="1" stopColor={shade(appearance.shirt)} /></linearGradient>
      </defs>
      <rect width="80" height="80" rx="21" fill={`url(#${id}-bg)`} />
      <circle cx="40" cy="35" r="27" fill="#fff" opacity=".4" />
      {/* Hair behind the face: each silhouette stays recognizable at 28px. */}
      {style === "bob" && <path d="M17 37C15 17 25 10 40 10C56 10 64 21 63 38L65 57Q55 64 40 59Q24 65 15 56Z" fill={hair} />}
      {style === "ponytail" && <><path d="M53 25C72 20 73 37 66 46Q61 54 67 60C53 61 53 46 56 38Z" fill={hair} /><path d="M55 28L63 31" stroke="#a9b5a1" strokeWidth="5" strokeLinecap="round" /></>}
      {style === "bun" && <><circle cx="43" cy="14" r="11" fill={hair} /><path d="M34 20Q43 25 52 20" stroke="#c6b4d2" strokeWidth="4" strokeLinecap="round" /></>}
      <path d="M9 80L12 68Q15 59 31 57H49Q65 59 68 68L72 80Z" fill={`url(#${id}-shirt)`} />
      {hoodie && <path d="M24 61Q25 52 32 54H48Q55 53 57 61L49 70H31Z" fill={shirt} stroke="#314942" strokeOpacity=".18" strokeWidth="2" />}
      <path d="M33 49H47V59Q40 67 33 59Z" fill={skin} />
      <path d="M33 50H47V55Q39 60 33 54Z" fill="#98654f" opacity=".2" />
      {!hoodie && <path d="M31 57L40 62L49 57L52 61L45 68L40 64L35 68L28 61Z" fill="#f0ebe2" />}
      <ellipse cx="21" cy="38" rx="4" ry="6" fill={skin} />
      <ellipse cx="59" cy="38" rx="4" ry="6" fill={skin} />
      <path d="M21 29Q21 13 40 13Q59 13 59 29V39C59 51 50 57 40 57C30 57 21 50 21 39Z" fill={`url(#${id}-skin)`} />
      <ellipse cx="28" cy="44" rx="4" ry="2.5" fill="#bf806f" opacity=".3" />
      <ellipse cx="52" cy="44" rx="4" ry="2.5" fill="#bf806f" opacity=".3" />
      <path d="M28 33Q31 31 34 33M46 33Q49 31 52 33" stroke={hair} strokeWidth="1.7" strokeLinecap="round" />
      <ellipse cx="31" cy="38" rx="1.7" ry="2.2" fill="#343536" />
      <ellipse cx="49" cy="38" rx="1.7" ry="2.2" fill="#343536" />
      <path d="M40 39L38 44H41" stroke="#a7755c" strokeOpacity=".55" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M35 48Q40 52 45 48" stroke="#855d50" strokeWidth="1.6" strokeLinecap="round" />
      {style === "swept" && <><path d="M20 35C15 17 24 9 40 10C57 7 63 19 59 34L54 26L50 19Q39 29 24 27L23 36Z" fill={hair} /><path d="M26 21Q36 21 45 16" stroke="#fff" strokeOpacity=".13" strokeWidth="2.5" strokeLinecap="round" /></>}
      {style === "bob" && <><path d="M20 37L18 29Q19 12 40 12Q61 12 62 32L59 40L55 26Q44 28 32 21Q30 29 23 31L24 44Z" fill={hair} /><path d="M23 24Q24 18 31 17" stroke="#fff" strokeOpacity=".13" strokeWidth="2.5" strokeLinecap="round" /></>}
      {style === "bun" && <><path d="M20 35Q15 15 37 17Q62 13 60 36L55 28Q43 30 33 22Q30 29 24 29L23 35Z" fill={hair} /><path d="M36 20Q43 25 53 25" stroke="#fff" strokeOpacity=".13" strokeWidth="2" strokeLinecap="round" /></>}
      {style === "curly" && <g fill={hair}><path d="M19 35V25Q18 14 40 14Q62 14 61 30L58 35L54 26H25L23 36Z" /><circle cx="23" cy="23" r="7" /><circle cx="29" cy="17" r="8" /><circle cx="39" cy="16" r="9" /><circle cx="49" cy="18" r="8" /><circle cx="57" cy="24" r="7" /><circle cx="35" cy="23" r="7" /><circle cx="46" cy="24" r="7" /><path d="M24 18Q28 13 33 15M39 11Q44 10 47 14" stroke="#fff" strokeOpacity=".13" strokeWidth="2" strokeLinecap="round" /></g>}
      {style === "headphones" && <><path d="M20 34Q15 13 36 12Q61 8 61 33L56 29L53 23Q43 28 26 25L24 34Z" fill={hair} /><path d="M17 35V30C17 4 63 4 63 30V35" stroke="#515d6a" strokeWidth="5" /><path d="M18 25C23 6 56 6 62 25" stroke="#abb7c7" strokeWidth="2" /><rect x="15" y="31" width="9" height="16" rx="4" fill="#abb7c7" /><rect x="56" y="31" width="9" height="16" rx="4" fill="#abb7c7" /><path d="M17 35V42M63 35V42" stroke="#e0e5eb" strokeWidth="2" strokeLinecap="round" /></>}
      {style === "ponytail" && <><path d="M20 35Q16 12 39 13Q59 11 60 34L56 33L53 24Q37 28 30 21Q27 29 23 30V36Z" fill={hair} /><path d="M35 17Q45 15 52 21" stroke="#fff" strokeOpacity=".13" strokeWidth="2" strokeLinecap="round" /></>}
      {hoodie && <g stroke="#edf1eb" strokeWidth="1.5" strokeLinecap="round" opacity=".8"><path d="M30 66L29 73M50 66L51 73" /></g>}
      <path d="M21 74L20 80M59 74L60 80" stroke="#263d37" strokeOpacity=".15" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </span>;
}
