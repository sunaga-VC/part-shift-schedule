/** ログイン用メール入力の正規化（全角英数→半角、不可視文字除去、trim、小文字化） */
export function normalizeEmailInput(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

export type LoginEmailParseResult =
  | { ok: true; email: string }
  | { ok: false; message: string };

/** 正規化後にログイン用メールとして妥当か検証する */
export function parseLoginEmail(raw: string): LoginEmailParseResult {
  const email = normalizeEmailInput(raw);
  if (!email) {
    return { ok: false, message: "メールアドレスを入力してください。" };
  }
  if (email.length > 254) {
    return { ok: false, message: "メールアドレスが長すぎます。" };
  }
  if (/\s/.test(email)) {
    return {
      ok: false,
      message: "メールアドレスに空白が含まれています。前後の空白や全角スペースを削除してください。",
    };
  }
  if (/[^\x00-\x7F]/.test(email)) {
    return {
      ok: false,
      message:
        "メールアドレスに使用できない文字（全角など）が含まれています。半角英数字で入力してください。",
    };
  }

  const atIndex = email.indexOf("@");
  if (atIndex < 0) {
    return {
      ok: false,
      message: "メールアドレスに @ が含まれていません。コピーした際に文字化けしていないか確認してください。",
    };
  }
  if (atIndex !== email.lastIndexOf("@")) {
    return { ok: false, message: "メールアドレスに @ が複数含まれています。" };
  }

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!local) {
    return { ok: false, message: "メールアドレスの @ より前（ユーザー名部分）が空です。" };
  }
  if (!domain) {
    return { ok: false, message: "メールアドレスの @ より後（ドメイン部分）が空です。" };
  }
  if (!domain.includes(".")) {
    return {
      ok: false,
      message: "ドメイン名に . が含まれていません（例: name@example.co.jp）。",
    };
  }
  if (domain.startsWith(".") || domain.endsWith(".")) {
    return { ok: false, message: "ドメイン名の形式が正しくありません。" };
  }
  if (local.startsWith(".") || local.endsWith(".")) {
    return { ok: false, message: "メールアドレスのユーザー名部分の形式が正しくありません。" };
  }

  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z0-9.\-]+[a-z0-9]$/.test(email)) {
    return {
      ok: false,
      message: "メールアドレスの形式が正しくありません。例: name@example.co.jp",
    };
  }

  return { ok: true, email };
}
