import {
  DEFAULT_GOAL_DEPARTMENT,
  GOAL_BLOCK_TIMES,
  GOAL_SLOT_MINUTES,
  isDefaultGoalDepartment,
  isOfficeGoalDepartment,
  type GoalBlockSlots,
} from "./goal";
import { getStaffShiftStatus, resolveAdminShiftDisplay } from "./publish-state";
import { toMinutes } from "./time";
import type { ConfirmedShift, DesiredShift, Staff } from "./types";

export type GoalBlockIconVariant = "hidden" | "default" | "half" | "heart" | "heart-half";
export type GoalBlockIconKind = "shortage" | "excess";

export type GoalBlockIconDisplay = {
  department: string;
  kind: GoalBlockIconKind;
  variant: GoalBlockIconVariant;
  staffedMinutes: number;
  requiredMinutes: number;
  fuelMinutes: number;
};

function normalizeGoalDepartmentKey(department: string): string {
  return isDefaultGoalDepartment(department) ? DEFAULT_GOAL_DEPARTMENT : department;
}

function calcOverlapMinutes(shiftStart: string, shiftEnd: string, blockStart: number, blockEnd: number): number {
  const start = toMinutes(shiftStart);
  const end = toMinutes(shiftEnd);
  return Math.max(0, Math.min(end, blockEnd) - Math.max(start, blockStart));
}

export function goalDepartmentsMatch(a: string, b: string): boolean {
  return normalizeGoalDepartmentKey(a) === normalizeGoalDepartmentKey(b);
}

/** 所属セクションのタイムラインに表示するアイコンか */
export function shouldShowGoalIconInSection(
  iconDepartment: string,
  iconKind: GoalBlockIconKind,
  sectionDepartment: string
): boolean {
  const inRecruitingSection = goalDepartmentsMatch(sectionDepartment, DEFAULT_GOAL_DEPARTMENT);
  const isRecruitingIcon = goalDepartmentsMatch(iconDepartment, DEFAULT_GOAL_DEPARTMENT);

  if (iconKind === "excess") {
    return inRecruitingSection && isRecruitingIcon;
  }

  if (goalDepartmentsMatch(iconDepartment, sectionDepartment)) {
    return true;
  }

  return inRecruitingSection && isOfficeGoalDepartment(iconDepartment);
}

export function buildGoalBlockIconKey(
  date: string,
  blockIndex: number,
  slotIndex: number,
  department: string
): string {
  return `${date}:${blockIndex}:${slotIndex}:${normalizeGoalDepartmentKey(department)}`;
}

export function isHeartVariant(variant: GoalBlockIconVariant): boolean {
  return variant === "heart" || variant === "heart-half";
}

export function isShortageVariant(variant: GoalBlockIconVariant): boolean {
  return variant === "default" || variant === "half";
}

export function resolveShortageVariantFromFuel(needMinutes: number): GoalBlockIconVariant {
  if (needMinutes <= 0) return "hidden";
  if (needMinutes < GOAL_SLOT_MINUTES / 2) return "half";
  return "default";
}

export function resolveHeartVariantFromFuel(excessMinutes: number): GoalBlockIconVariant {
  if (excessMinutes <= 0) return "hidden";
  if (excessMinutes >= GOAL_SLOT_MINUTES) return "heart";
  return "heart-half";
}

export function resolveVariantFromFuel(kind: GoalBlockIconKind, fuelMinutes: number): GoalBlockIconVariant {
  return kind === "excess"
    ? resolveHeartVariantFromFuel(fuelMinutes)
    : resolveShortageVariantFromFuel(fuelMinutes);
}

function buildStaffedMinutesByDepartment(input: {
  date: string;
  blockIndex: number;
  staffList: Staff[];
  desiredShifts: DesiredShift[];
  confirmedShifts: ConfirmedShift[];
}): Record<string, number> {
  const block = GOAL_BLOCK_TIMES[input.blockIndex];
  const blockStart = toMinutes(block.start);
  const blockEnd = toMinutes(block.end);
  const totals: Record<string, number> = {};

  for (const staff of input.staffList) {
    if (staff.role !== "worker" || staff.status !== "active") continue;
    const desiredShift = input.desiredShifts.find(
      (shift) => shift.date === input.date && shift.staffId === staff.id
    );
    const confirmedShift = input.confirmedShifts.find(
      (shift) => shift.date === input.date && shift.staffId === staff.id
    );
    const currentStatus = getStaffShiftStatus(confirmedShift, desiredShift);
    if (currentStatus === "unconfirmed") continue;

    const shift = resolveAdminShiftDisplay(confirmedShift, desiredShift, { currentStatus });
    if (!shift) continue;

    const overlapMinutes = calcOverlapMinutes(shift.startTime, shift.endTime, blockStart, blockEnd);
    if (overlapMinutes <= 0) continue;

    const departmentKey = normalizeGoalDepartmentKey(staff.team);
    totals[departmentKey] = (totals[departmentKey] ?? 0) + overlapMinutes;
  }

  return totals;
}

type SlotIconState = {
  kind: GoalBlockIconKind;
  variant: GoalBlockIconVariant;
  fuelMinutes: number;
};

function distributeDepartmentBlockIcons(slotCount: number, staffedMinutes: number): SlotIconState[] {
  const results: SlotIconState[] = Array.from({ length: slotCount }, () => ({
    kind: "shortage",
    variant: "hidden",
    fuelMinutes: 0,
  }));
  if (slotCount === 0) return results;

  const totalRequired = slotCount * GOAL_SLOT_MINUTES;

  if (staffedMinutes >= totalRequired) {
    let remainingExcess = staffedMinutes - totalRequired;
    for (let index = 0; index < slotCount; index += 1) {
      if (remainingExcess <= 0) break;
      const slotFuel = Math.min(remainingExcess, GOAL_SLOT_MINUTES);
      const variant = resolveHeartVariantFromFuel(slotFuel);
      if (variant !== "hidden") {
        results[index] = { kind: "excess", variant, fuelMinutes: slotFuel };
      }
      remainingExcess -= GOAL_SLOT_MINUTES;
    }
    return results;
  }

  let remainingShortage = totalRequired - staffedMinutes;
  for (let index = 0; index < slotCount; index += 1) {
    if (remainingShortage <= 0) break;
    const slotFuel = Math.min(remainingShortage, GOAL_SLOT_MINUTES);
    const variant = resolveShortageVariantFromFuel(slotFuel);
    if (variant !== "hidden") {
      results[index] = { kind: "shortage", variant, fuelMinutes: slotFuel };
    }
    remainingShortage -= GOAL_SLOT_MINUTES;
  }
  return results;
}

export function buildGoalBlockIconDisplays(input: {
  date: string;
  goalBlocks: GoalBlockSlots;
  staffList: Staff[];
  desiredShifts: DesiredShift[];
  confirmedShifts: ConfirmedShift[];
}): GoalBlockIconDisplay[][] {
  return input.goalBlocks.map((slots, blockIndex) => {
    const staffedByDepartment = buildStaffedMinutesByDepartment({
      date: input.date,
      blockIndex,
      staffList: input.staffList,
      desiredShifts: input.desiredShifts,
      confirmedShifts: input.confirmedShifts,
    });

    const slotsByDepartment = new Map<string, { department: string; slotIndices: number[] }>();
    slots.forEach((department, slotIndex) => {
      const departmentKey = normalizeGoalDepartmentKey(department);
      const entry = slotsByDepartment.get(departmentKey) ?? { department, slotIndices: [] };
      entry.slotIndices.push(slotIndex);
      slotsByDepartment.set(departmentKey, entry);
    });

    const slotStates: SlotIconState[] = slots.map(() => ({
      kind: "shortage",
      variant: "hidden",
      fuelMinutes: 0,
    }));

    for (const { department, slotIndices } of slotsByDepartment.values()) {
      const departmentKey = normalizeGoalDepartmentKey(department);
      const staffedMinutes = staffedByDepartment[departmentKey] ?? 0;
      const distributed = distributeDepartmentBlockIcons(slotIndices.length, staffedMinutes);
      slotIndices.forEach((slotIndex, index) => {
        slotStates[slotIndex] = distributed[index];
      });
    }

    return slots.map((department, slotIndex) => {
      const departmentKey = normalizeGoalDepartmentKey(department);
      const state = slotStates[slotIndex];
      return {
        department,
        kind: state.kind,
        variant: state.variant,
        staffedMinutes: staffedByDepartment[departmentKey] ?? 0,
        requiredMinutes: GOAL_SLOT_MINUTES,
        fuelMinutes: state.fuelMinutes,
      };
    });
  });
}

export function buildInitialGoalIconFuel(
  date: string,
  goalBlockIconDisplays: GoalBlockIconDisplay[][]
): Record<string, number> {
  const fuel: Record<string, number> = {};
  goalBlockIconDisplays.forEach((block, blockIndex) => {
    block.forEach((icon, slotIndex) => {
      if (icon.variant === "hidden" || icon.fuelMinutes <= 0) return;
      fuel[buildGoalBlockIconKey(date, blockIndex, slotIndex, icon.department)] = icon.fuelMinutes;
    });
  });
  return fuel;
}

export function transferGoalIconFuel(input: {
  fuelByKey: Record<string, number>;
  kindByKey: Record<string, GoalBlockIconKind>;
  heartKey: string;
  shortageKey: string;
}): Record<string, number> | null {
  const heartFuel = input.fuelByKey[input.heartKey] ?? 0;
  const shortageFuel = input.fuelByKey[input.shortageKey] ?? 0;
  if (heartFuel <= 0 || shortageFuel <= 0) return null;
  if (input.kindByKey[input.heartKey] !== "excess") return null;
  if (input.kindByKey[input.shortageKey] !== "shortage") return null;

  const transfer = Math.min(heartFuel, shortageFuel);
  return {
    ...input.fuelByKey,
    [input.heartKey]: heartFuel - transfer,
    [input.shortageKey]: shortageFuel - transfer,
  };
}
