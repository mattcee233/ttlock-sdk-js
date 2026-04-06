'use strict';
import { logger } from "../../util/logger";
const log = logger.child({ name: 'Cmd/SetAdminPwd' });

import { CommandType } from "../../constant/CommandType";
import { Command } from "../Command";

export class SetAdminKeyboardPwdCommand extends Command {
  static COMMAND_TYPE: CommandType = CommandType.COMM_SET_ADMIN_KEYBOARD_PWD;

  private adminPasscode?: string;

  protected processData(): void {
    // do nothing yet, we don't know if the lock returns anything
    if(this.commandData && this.commandData.length > 0) {
      log.debug(`SetAdminKeyboardPwdCommand received: ${this.commandData}`);
    }
    // throw new Error("Method not implemented.");
  }

  build(): Buffer {
    if (this.adminPasscode) {
      const data = Buffer.alloc(this.adminPasscode.length);
      for (let i = 0; i < this.adminPasscode.length; i++) {
        data[i] = parseInt(this.adminPasscode.charAt(i));
      }
      return data;
    } else {
      return Buffer.from([]);
    }
  }

  setAdminPasscode(adminPasscode: string) {
    this.adminPasscode = adminPasscode;
  }

  getAdminPasscode(): string | void {
    return this.adminPasscode;
  }
}