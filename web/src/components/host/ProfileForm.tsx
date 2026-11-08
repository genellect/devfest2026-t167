"use client";
import { useEffect, useState } from "react";
import { getProfile, saveProfile } from "@/lib/local";

/** Hostのプロフィールの入力。この端末にだけ保存する */
export function ProfileForm({ defaultName, submitLabel, onSaved }: { defaultName: string; submitLabel: string; onSaved: () => void }) {
  const [name, setName] = useState(defaultName);
  const [school, setSchool] = useState("");
  const [className, setClassName] = useState("");
  useEffect(() => {
    const p = getProfile();
    if (p) { setName(p.name); setSchool(p.school ?? ""); setClassName(p.className ?? ""); }
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    saveProfile({ name: name.trim(), school: school.trim() || undefined, className: className.trim() || undefined });
    onSaved();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor="pname">表示する名前</label>
        <input id="pname" className="input" value={name} maxLength={30} placeholder="例：佐藤Host" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label className="field__label" htmlFor="school">学校名（任意）</label>
          <input id="school" className="input" value={school} maxLength={40} placeholder="例：〇〇大学" onChange={(e) => setSchool(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="cls">よく使うクラス・授業名（任意）</label>
          <input id="cls" className="input" value={className} maxLength={40} placeholder="例：2年3組 探究の授業" onChange={(e) => setClassName(e.target.value)} />
        </div>
      </div>
      <p className="field__hint">プロフィールはこの端末にだけ保存します。参加者には表示しません。</p>
      <div className="home-actions"><button className="btn btn--blue" type="submit" disabled={!name.trim()}>{submitLabel}</button></div>
    </form>
  );
}
