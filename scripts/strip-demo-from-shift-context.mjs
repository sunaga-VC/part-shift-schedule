import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), "src/components/context/ShiftContext.tsx");
let content = readFileSync(path, "utf8");

content = content.replace(
  'import { createInitialState } from "@/lib/shift/seed";\n',
  ""
);
content = content.replace(
  /import \{\n  createEmptyShiftPersistenceFallback,\n  type ShiftPersistenceSnapshot,\n\} from "@\/lib\/supabase\/shiftPersistence";/,
  `import {
  createEmptyAppState,
  createEmptyShiftPersistenceFallback,
  type ShiftPersistenceSnapshot,
} from "@/lib/supabase/shiftPersistence";`
);

content = content.replace(/\nconst STORAGE_KEY = "shift-app-state-v1";\n/, "\n");

content = content.replace(
  /function loadState\(\): AppState \{[\s\S]*?\n\}\n\nasync function detectSupabaseSession\(\): Promise<boolean> \{[\s\S]*?\n\}\n\n/,
  ""
);

content = content.replace(
  /  \/\*\* Supabase Auth でログイン中（デモ切替を出さない） \*\/\n  usingSupabaseAuth: boolean;\n/,
  ""
);
content = content.replace(/  setCurrentUserId: \(id: string\) => void;\n/, "");
content = content.replace(/  resetDemoData: \(\) => void;\n/, "");

content = content.replace(
  /  const \[state, setState\] = useState<AppState>\(createInitialState\);/,
  "  const [state, setState] = useState<AppState>(createEmptyAppState);"
);
content = content.replace(
  /  const \[usingSupabaseAuth, setUsingSupabaseAuth\] = useState\(false\);\n  const usingSupabaseAuthRef = useRef\(false\);\n/,
  ""
);
content = content.replace(
  /buildShiftPersistenceSnapshot\(createInitialState\(\)\)/g,
  "buildShiftPersistenceSnapshot(createEmptyAppState())"
);

content = content.replace(
  /      if \(!merged \|\| !usingSupabaseAuthRef\.current\) \{\n        return \{ ok: true as const \};\n      \}/,
  "      if (!merged) {\n        return { ok: true as const };\n      }"
);
content = content.replace(
  /    if \(!usingSupabaseAuthRef\.current \|\| entries\.length === 0\) return;/,
  "    if (entries.length === 0) return;"
);
content = content.replace(
  /  const refreshStaffFromSupabase = useCallback\(async \(\) => \{\n    if \(!usingSupabaseAuthRef\.current\) return;\n    try \{/,
  "  const refreshStaffFromSupabase = useCallback(async () => {\n    try {"
);

content = content.replace(
  /    async function applyAuthUser\(userId: string \| null\) \{\n      if \(!userId\) \{\n        usingSupabaseAuthRef\.current = false;\n        if \(!cancelled\) \{\n          setUsingSupabaseAuth\(false\);\n          setState\(loadState\(\)\);\n          setReady\(true\);\n        \}\n        return;\n      \}\n\n      try \{\n        const supabase = createClient\(\);\n        usingSupabaseAuthRef\.current = true;\n        if \(!cancelled\) \{\n          setUsingSupabaseAuth\(true\);\n          setReady\(false\);\n        \}/,
  `    async function applyAuthUser(userId: string | null) {
      if (!userId) {
        if (!cancelled) {
          setState(createEmptyAppState());
          setReady(true);
        }
        return;
      }

      try {
        const supabase = createClient();
        if (!cancelled) {
          setReady(false);
        }`
);

content = content.replace(
  /        lastShiftPersistSignatureRef\.current = buildShiftPersistenceSignature\(remote\.shiftSnapshot\);\n\n        \/\/ 古いデモデータが混ざらないよう Supabase ログイン時は localStorage を消す\n        try \{\n          window\.localStorage\.removeItem\(STORAGE_KEY\);\n        \} catch \{\n          \/\/ ignore\n        \}\n\n        setState\(\{/,
  `        lastShiftPersistSignatureRef.current = buildShiftPersistenceSignature(remote.shiftSnapshot);

        setState({`
);

content = content.replace(
  /      \} catch \(error\) \{\n        console\.warn\("Supabase auth boot failed", error\);\n        if \(!cancelled\) \{\n          setUsingSupabaseAuth\(false\);\n          setState\(loadState\(\)\);\n          setReady\(true\);\n        \}\n      \}/,
  `      } catch (error) {
        console.warn("Supabase auth boot failed", error);
        if (!cancelled) {
          setState(createEmptyAppState());
          setReady(true);
        }
      }`
);

content = content.replace(
  /\n  useEffect\(\(\) => \{\n    if \(!ready \|\| usingSupabaseAuth\) return;\n    window\.localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(state\)\);\n  \}, \[state, ready, usingSupabaseAuth\]\);\n/,
  "\n"
);

content = content.replace(
  /  const flushShiftPersist = useCallback\(async \(\): Promise<\{ ok: true \} \| \{ ok: false; message: string \}> => \{\n    if \(!usingSupabaseAuthRef\.current\) return \{ ok: true \};\n    const currentUser/,
  "  const flushShiftPersist = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {\n    const currentUser"
);

content = content.replace(
  /  useEffect\(\(\) => \{\n    if \(!ready \|\| !usingSupabaseAuth \|\| !currentUserForSync\) return;/,
  "  useEffect(() => {\n    if (!ready || !currentUserForSync) return;"
);
content = content.replace(
  /  \}, \[ready, state, usingSupabaseAuth, currentUserForSync, runShiftPersist\]\);/,
  "  }, [ready, state, currentUserForSync, runShiftPersist]);"
);

content = content.replace(
  /\n  useEffect\(\(\) => \{\n    const onStorage = \(event: StorageEvent\) => \{[\s\S]*?\n  \}, \[\]\);\n/,
  "\n"
);

content = content.replace(
  /  useEffect\(\(\) => \{\n    if \(!ready \|\| !usingSupabaseAuth\) return;\n    let cancelled = false;/,
  "  useEffect(() => {\n    if (!ready || !currentUserForSync) return;\n    let cancelled = false;"
);
content = content.replace(
  /  \}, \[ready, usingSupabaseAuth\]\);\n\n  useEffect\(\(\) => \{\n    const onHide/,
  "  }, [ready, currentUserForSync]);\n\n  useEffect(() => {\n    const onHide"
);

content = content.replace(
  /  const currentUser = useMemo\(\(\): Staff \| undefined => \{\n    const matched = state\.staffList\.find\(\(s\) => s\.id === state\.currentUserId\);\n    if \(matched\) return matched;\n    \/\/ Supabase ログイン中は別ユーザーへフォールバックしない（前の管理者名が残るのを防ぐ）\n    if \(usingSupabaseAuth\) return undefined;\n    return state\.staffList\[0\];\n  \}, \[state\.currentUserId, state\.staffList, usingSupabaseAuth\]\);/,
  "  const currentUser = useMemo((): Staff | undefined => {\n    return state.staffList.find((s) => s.id === state.currentUserId);\n  }, [state.currentUserId, state.staffList]);"
);

content = content.replace(
  /\n  const setCurrentUserId = useCallback\(\n    \(id: string\) => \{\n      if \(usingSupabaseAuth\) return;\n      setState\(\(prev\) => \(\{ \.\.\.prev, currentUserId: id \}\)\);\n    \},\n    \[usingSupabaseAuth\]\n  \);\n/,
  "\n"
);

content = content.replace(
  /        \/\/ Supabase 利用時は departments テーブルの内容だけを正とする（所属名の勝手な追加はしない）\n        departments:\n          !usingSupabaseAuthRef\.current && patch\.team && !prev\.departments\.includes\(patch\.team\)\n            \? \[\.\.\.prev\.departments, patch\.team\]\n            : prev\.departments,/,
  "        departments: prev.departments,"
);

content = content.replace(/\n    if \(!usingSupabaseAuthRef\.current\) return;\n\n    const \{ password: _password/, "\n    const { password: _password");

content = content.replace(
  /\n      if \(!usingSupabaseAuthRef\.current\) \{\n        return \{ ok: true as const \};\n      \}\n\n      const \{ password: _password, salaryHistory: _salaryHistory, \.\.\.persistable \} = patch;/,
  "\n      const { password: _password, salaryHistory: _salaryHistory, ...persistable } = patch;"
);

// Unwrap supabase session checks for async staff ops
const unwrapPattern = /if \(usingSupabaseAuthRef\.current \|\| \(await detectSupabaseSession\(\)\)\) \{\n      usingSupabaseAuthRef\.current = true;\n      setUsingSupabaseAuth\(true\);\n      try \{/g;
while (unwrapPattern.test(content)) {
  content = content.replace(unwrapPattern, "try {");
}

const loggedInPattern = /const loggedIn = usingSupabaseAuthRef\.current \|\| \(await detectSupabaseSession\(\)\);\n    if \(loggedIn\) \{\n      usingSupabaseAuthRef\.current = true;\n      setUsingSupabaseAuth\(true\);\n      try \{/g;
content = content.replace(loggedInPattern, "try {");

// Remove local fallback blocks after API try/catch in several functions - use heuristic:
// For changeStaffPassword - remove local setState after API block
content = content.replace(
  /\n    setState\(\(prev\) => \(\{\n      \.\.\.prev,\n      staffList: prev\.staffList\.map\(\(staff\) =>\n        staff\.id === staffId \? normalizeStaff\(\{ \.\.\.staff, password \}\) : staff\n      \),\n    \}\)\);\n    return \{ ok: true as const \};\n  \}, \[flushStaffPersistForStaff, state\.currentUserId, state\.staffList\]\);/,
  "\n  }, [flushStaffPersistForStaff, state.currentUserId, state.staffList]);"
);

// addSalaryRaise local fallback removal
content = content.replace(
  /\n      const entry: SalaryRaise = \{[\s\S]*?\n      return \{ ok: true as const \};\n    \},\n    \[\]\n  \);\n\n  const updateSalaryRaise/,
  "\n    },\n    [refreshStaffFromSupabase]\n  );\n\n  const updateSalaryRaise"
);

// updateSalaryRaise local fallback
content = content.replace(
  /\n      setState\(\(prev\) => \(\{\n        \.\.\.prev,\n        staffList: prev\.staffList\.map\(\(staff\) => \{[\s\S]*?\n      return \{ ok: true as const \};\n    \},\n    \[\]\n  \);\n\n  const addDepartment/,
  "\n    },\n    [refreshStaffFromSupabase]\n  );\n\n  const addDepartment"
);

// addDepartment local fallback
content = content.replace(
  /\n    setState\(\(prev\) =>\n      prev\.departments\.includes\(trimmed\) \? prev : \{ \.\.\.prev, departments: \[\.\.\.prev\.departments, trimmed\] \}\n    \);\n    return \{ ok: true as const \};\n  \}, \[\]\);/,
  "\n  }, [refreshStaffFromSupabase]);"
);

// updateDepartment local fallback - large block
content = content.replace(
  /\n    setState\(\(prev\) => \(\{\n      \.\.\.prev,\n      staffList: prev\.staffList\.map\(\(staff\) => \(staff\.team === oldName \? \{ \.\.\.staff, team: trimmed \} : staff\)\),\n      departments: prev\.departments\.map\(\(department\) => \(department === oldName \? trimmed : department\)\),\n      goalBlocksByDate: Object\.fromEntries\([\s\S]*?\n    return \{ ok: true as const \};\n  \}, \[\]\);/,
  "\n  }, [refreshStaffFromSupabase]);"
);

// deleteDepartment local fallback
content = content.replace(
  /\n    setState\(\(prev\) => \(\{\n      \.\.\.prev,\n      departments: prev\.departments\.filter\(\(department\) => department !== name\),\n      goalBlocksByDate: Object\.fromEntries\([\s\S]*?\n    return \{ ok: true as const \};\n  \}, \[\]\);/,
  "\n  }, [refreshStaffFromSupabase]);"
);

// createStaff local fallback - from `const id = staff-${Date.now()}` to end before deleteStaff
content = content.replace(
  /\n    const id = `staff-\$\{Date\.now\(\)\}`;[\s\S]*?\n    return \{ ok: true as const, id \};\n  \}, \[currentUser\]\);/,
  "\n  }, [currentUser, refreshStaffFromSupabase]);"
);

// deleteStaff local fallback - need to read and handle

// createHomeMessage local fallback
content = content.replace(
  /\n      const body = input\.body\.trim\(\);\n      if \(!body\) return \{ ok: false as const, message: "メッセージを入力してください。" \};\n      if \(input\.audience === "team" && !input\.team\?\.trim\(\)\) \{\n        return \{ ok: false as const, message: "所属を選択してください。" \};\n      \}\n      setState\(\(prev\) => \{[\s\S]*?\n      return \{ ok: true as const \};\n    \},\n    \[canManageMaster\]\n  \);/,
  "\n    },\n    [canManageMaster]\n  );"
);

// deleteHomeMessage - unwrap if (usingSupabaseAuthRef.current)
content = content.replace(
  /      if \(usingSupabaseAuthRef\.current\) \{\n        try \{/,
  "      try {"
);
content = content.replace(
  /\n        return;\n      \}\n\n      setState\(\(prev\) => \(\{\n        \.\.\.prev,\n        homeMessages: \(prev\.homeMessages \?\? \[\]\)\.filter\(\(m\) => m\.id !== messageId\),\n      \}\)\);\n    \},\n    \[canManageMaster\]\n  \);/,
  "\n    },\n    [canManageMaster]\n  );"
);

content = content.replace(
  /\n  const resetDemoData = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);\n/,
  "\n"
);

content = content.replace(/    usingSupabaseAuth,\n/, "");
content = content.replace(/    setCurrentUserId,\n/, "");
content = content.replace(/    resetDemoData,\n/, "");

content = content.replace(
  /        period: shouldMarkAdjusting \|\| existingConfirmed\n          \? \{ \.\.\.prev\.period, adjustmentStatus: "adjusting", updatedAt: now \}\n          : prev\.period,/,
  `        period: shouldMarkAdjusting || existingConfirmed
          ? { ...prev.period, adjustmentStatus: "adjusting" as const, updatedAt: now }
          : prev.period,`
);

writeFileSync(path, content);
console.log("Updated ShiftContext.tsx");
