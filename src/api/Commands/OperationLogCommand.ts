'use strict';
import { logger } from "../../util/logger";
const log = logger.child({ name: 'Cmd/OperationLog' });

import { CommandType } from "../../constant/CommandType";
import { LogOperate } from "../../constant/LogOperate";
import { Command } from "../Command";

export interface LogEntry {
  recordNumber: number;
  recordType: LogOperate;
  recordId?: number;
  uid?: number;
  password?: string;
  newPassword?: string;
  operateDate: string;
  deleteDate?: string;
  electricQuantity: number;
  accessoryElectricQuantity?: number;
  keyId?: number;
}

export class OperationLogCommand extends Command {
  static COMMAND_TYPE: CommandType = CommandType.COMM_GET_OPERATE_LOG;

  private sequence?: number;
  private logs?: LogEntry[];

  protected processData(): void {
    if (this.commandData && this.commandData.length >= 2) {
      const totalLen = this.commandData.readUInt16BE(0);
      this.logs = [];
      this.sequence = 0;
      if (totalLen > 0) {
        this.sequence = this.commandData.readUInt16BE(2);
        let index = 4;
        while (index < this.commandData.length) {
          const recLen = this.commandData.readUInt8(index++);
          const recStart = index;
          let entry: LogEntry = {
            recordNumber: this.sequence - 1,
            recordType: this.commandData.readUInt8(index++),
            operateDate: "20" + this.commandData.readUInt8(index++).toString().padStart(2, '0') // year
              + this.commandData.readUInt8(index++).toString().padStart(2, '0') // month
              + this.commandData.readUInt8(index++).toString().padStart(2, '0') // day
              + this.commandData.readUInt8(index++).toString().padStart(2, '0') // hour
              + this.commandData.readUInt8(index++).toString().padStart(2, '0') // minutes
              + this.commandData.readUInt8(index++).toString().padStart(2, '0'), // seconds
            electricQuantity: this.commandData.readUInt8(index++)
          };
          let pwdLen: number = 0;
          switch (entry.recordType) {
            case LogOperate.OPERATE_TYPE_MOBILE_UNLOCK:
            case LogOperate.OPERATE_BLE_LOCK:
            case LogOperate.GATEWAY_UNLOCK:
            case LogOperate.APP_UNLOCK_FAILED_LOCK_REVERSE:
            case LogOperate.REMOTE_CONTROL_KEY:
              entry.uid = this.commandData.readUInt32BE(index);
              index += 4;
              entry.recordId = this.commandData.readUInt32BE(index);
              index += 4;
              if (entry.recordType == LogOperate.REMOTE_CONTROL_KEY) {
                entry.keyId = this.commandData.readUInt8(index++);
              }
              break;

            case LogOperate.OPERATE_TYPE_KEYBOARD_PASSWORD_UNLOCK:
            case LogOperate.OPERATE_TYPE_USE_DELETE_CODE:
            case LogOperate.OPERATE_TYPE_PASSCODE_EXPIRED:
            case LogOperate.OPERATE_TYPE_SPACE_INSUFFICIENT:
            case LogOperate.OPERATE_TYPE_PASSCODE_IN_BLACK_LIST:
            case LogOperate.PASSCODE_LOCK:
            case LogOperate.PASSCODE_UNLOCK_FAILED_LOCK_REVERSE:

            case LogOperate.OPERATE_TYPE_KEYBOARD_MODIFY_PASSWORD:
            case LogOperate.OPERATE_TYPE_KEYBOARD_REMOVE_SINGLE_PASSWORD:

            case LogOperate.OPERATE_TYPE_KEYBOARD_PASSWORD_KICKED:
              pwdLen = this.commandData.readUInt8(index++);
              entry.password = this.commandData.slice(index, index + pwdLen).toString("ascii");
              index += pwdLen;
              pwdLen = this.commandData.readUInt8(index++);
              entry.newPassword = this.commandData.slice(index, index + pwdLen).toString("ascii");
              index += pwdLen;
              break;

            case LogOperate.OPERATE_TYPE_ERROR_PASSWORD_UNLOCK:
              pwdLen = this.commandData.readUInt8(index++);
              entry.password = this.commandData.slice(index, index + pwdLen).toString("ascii");
              index += pwdLen;
              break;

            case LogOperate.OPERATE_TYPE_KEYBOARD_REMOVE_ALL_PASSWORDS:
              entry.deleteDate = "20" + this.commandData.readUInt8(index++).toString().padStart(2, '0') // year
                + this.commandData.readUInt8(index++).toString().padStart(2, '0') // month
                + this.commandData.readUInt8(index++).toString().padStart(2, '0') // day
                + this.commandData.readUInt8(index++).toString().padStart(2, '0') // hour
                + this.commandData.readUInt8(index++).toString().padStart(2, '0'); // minutes
              break;

            case LogOperate.OPERATE_TYPE_ADD_IC:
            case LogOperate.OPERATE_TYPE_DELETE_IC_SUCCEED:
            case LogOperate.OPERATE_TYPE_IC_UNLOCK_SUCCEED:
            case LogOperate.OPERATE_TYPE_IC_UNLOCK_FAILED:
            case LogOperate.IC_LOCK:
            case LogOperate.IC_UNLOCK_FAILED_LOCK_REVERSE:
              pwdLen = recLen - (index - recStart); // what's left
              if (pwdLen == 4) {
                entry.password = this.commandData.readUInt32BE(index).toString();
              } else {
                entry.password = this.commandData.readBigUInt64BE(index).toString();
              }
              index += pwdLen;
              break;

            case LogOperate.OPERATE_TYPE_BONG_UNLOCK_SUCCEED:
              entry.password = this.commandData.readUInt8(index + 5).toString(16) + ':'
                + this.commandData.readUInt8(index + 4).toString(16) + ':'
                + this.commandData.readUInt8(index + 3).toString(16) + ':'
                + this.commandData.readUInt8(index + 2).toString(16) + ':'
                + this.commandData.readUInt8(index + 1).toString(16) + ':'
                + this.commandData.readUInt8(index).toString(16)
              index += 6;
              break;

            case LogOperate.OPERATE_TYPE_FR_UNLOCK_SUCCEED:
            case LogOperate.OPERATE_TYPE_ADD_FR:
            case LogOperate.OPERATE_TYPE_FR_UNLOCK_FAILED:
            case LogOperate.OPERATE_TYPE_DELETE_FR_SUCCEED:
            case LogOperate.FR_LOCK:
            case LogOperate.FR_UNLOCK_FAILED_LOCK_REVERSE:
              entry.password = Buffer.concat([
                Buffer.from([0, 0]),
                this.commandData.slice(index, index + 6)
              ]).readBigInt64BE().toString();
              index += 6;
              if (index < recStart + recLen) {
                pwdLen = recLen - (index - recStart); // what's left
                entry.newPassword = this.commandData.slice(index, index + pwdLen).toString("ascii");
                index += pwdLen;
              }
              break;

            case LogOperate.WIRELESS_KEY_FOB:
            case LogOperate.WIRELESS_KEY_PAD:
              entry.password = this.commandData.readUInt8(index + 5).toString(16) + ':'
                + this.commandData.readUInt8(index + 4).toString(16) + ':'
                + this.commandData.readUInt8(index + 3).toString(16) + ':'
                + this.commandData.readUInt8(index + 2).toString(16) + ':'
                + this.commandData.readUInt8(index + 1).toString(16) + ':'
                + this.commandData.readUInt8(index).toString(16)
              index += 6;
              entry.keyId = this.commandData.readUInt8(index++);
              entry.accessoryElectricQuantity = this.commandData.readUInt8(index++);
              break;

            default:
              pwdLen = recLen - (index - recStart);
              if (pwdLen > 0) {
                log.error(`LogOperate not implemented recordType=${entry.recordType} data=${this.commandData.slice(index, index + pwdLen).toString("hex")}`);
                index = recStart + recLen;
              }
          }

          this.logs.push(entry);
        }
      }
    }
  }

  build(): Buffer {
    if (typeof this.sequence == "undefined") {
      this.sequence = 0xffff;
    }
    let data = Buffer.alloc(2);
    data.writeUInt16BE(this.sequence);
    return data;
  }

  setSequence(sequence: number) {
    this.sequence = sequence;
  }

  getSequence(): number {
    if (typeof this.sequence == "undefined") {
      return 0xffff;
    } else {
      return this.sequence;
    }
  }

  getLogs(): LogEntry[] {
    if (typeof this.logs == "undefined") {
      return [];
    } else {
      return this.logs;
    }
  }
}