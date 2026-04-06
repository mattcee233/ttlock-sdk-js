'use strict';
import { logger } from "../../util/logger";
const log = logger.child({ name: 'Cmd/Unknown' });

import { Command } from "../Command";

export class UnknownCommand extends Command {
  
  protected processData(): void {
    if (this.commandData) {
      log.error("Unknown command type 0x" + this.commandData.readInt8().toString(16), "succes", this.commandResponse, "data", this.commandData.toString("hex"));
    }
  }
  
  build(): Buffer {
    throw new Error("Method not implemented.");
  }
}