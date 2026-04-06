'use strict';

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);
import { DateConstant } from "../constant/DateConstant";

export enum ValidityType {
  TIMED = 1,
  CYCLIC = 4
}

export interface CyclicConfig {
  /** 1-7 monday-sunday */
  weekDay: number,
  /** minute of the day for start (Ex: 02:14 = 2*60 + 14 = 134) */
  startTime: number;
  /** minute of the day to end (Ex: 16:48 = 16*60 + 48 = 1008) */
  endTime: number;
}

export class ValidityInfo {
  private type: ValidityType;
  private startDate: dayjs.Dayjs;
  private endDate: dayjs.Dayjs;
  private cycles: CyclicConfig[];

  constructor(type: ValidityType = ValidityType.TIMED, startDate: string = DateConstant.START_DATE_TIME, endDdate: string = DateConstant.END_DATE_TIME) {
    this.type = type;
    this.startDate = dayjs(startDate, "YYYYMMDDHHmm");
    if (!this.startDate.isValid()) {
      throw new Error("Invalid startDate");
    }
    this.endDate = dayjs(endDdate, "YYYYMMDDHHmm");
    if (!this.endDate.isValid()) {
      throw new Error("Invalid endDate");
    }
    this.cycles = [];
  }

  setType(type: ValidityType) {
    this.type = type;
  }

  addCycle(cycle: CyclicConfig): boolean {
    if (this.isValidCycle(cycle)) {
      this.cycles.push(cycle);
      return true;
    }
    return false;
  }

  setStartDate(startDate: string): boolean {
    let date = dayjs(startDate, "YYYYMMDDHHmm");
    if (date.isValid()) {
      this.startDate = date;
      return true;
    }
    return false;
  }

  setEndDate(endDate: string): boolean {
    let date = dayjs(endDate, "YYYYMMDDHHmm");
    if (date.isValid()) {
      this.endDate = date;
      return true;
    }
    return false;
  }

  getType(): ValidityType {
    return this.type;
  }

  getStartDate(): string {
    return this.startDate.format("YYYYMMDDHHmm");
  }

  getStartDateMoment(): dayjs.Dayjs {
    return this.startDate;
  }

  getEndDate(): string {
    return this.endDate.format("YYYYMMDDHHmm");
  }

  geetEndDateMoment(): dayjs.Dayjs {
    return this.endDate;
  }

  getCycles(): CyclicConfig[] {
    return this.cycles;
  }

  isValidCycle(cycle: CyclicConfig) {
    if (cycle.weekDay < 1 || cycle.weekDay > 7) return false;
    if (cycle.startTime < 0 || cycle.startTime > 24 * 60) return false;
    if (cycle.endTime < 0 || cycle.endTime > 24 * 60) return false;
    return true;
  }
}