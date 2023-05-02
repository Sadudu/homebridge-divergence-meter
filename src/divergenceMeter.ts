import noble, {Peripheral} from '@abandonware/noble';
import {Logger, API} from 'homebridge';

// Characteristics does not work if another plugin (homebridge-mi-hygrothermograph)
// uses noble as well. Not sure why.
const HANDLE = 5;

const PERIPHERAL_NAME = 'Divergence';

export class DivergenceMeter {
  private peripheral: Peripheral | null = null;
  private isScanning = false;
  private isActuallyScanning = false;

  constructor(
    public readonly log: Logger,
    public readonly api: API,
    private scanningRestartDelay: number,
  ) {
    this.log.debug('scanningRestartDelay = ' + scanningRestartDelay);
    noble.on('stateChange', this.onNobleStateChange.bind(this));
    noble.on('discover', this.onDiscoverPeripheral.bind(this));
    noble.on('scanStart', this.onNobleScanStart.bind(this));
    noble.on('scanStop', this.onNobelScanStop.bind(this));
    noble.on('warning', this.onNobelWarning.bind(this));
  }

  onNobleStateChange(state: string) {
    if (state === 'poweredOn') {
      this.startScanning();
    } else {
      this.log.info(`Noble state changed to ${state}`);
      this.isScanning = false;
      noble.stopScanning();
    }
  }

  onNobelWarning(message) {
    this.log.info('Noble warning: ', message);
  }

  onNobelScanStop() {
    this.log.debug('On scanStop (this app or another app)');
    this.isActuallyScanning = false;
    if (this.isScanning) {  // still scanning, not stop by this plugin
      this.log.debug('Decided to start scanning after some time');
      setTimeout(() => {
        this.startScanning();
      }, this.scanningRestartDelay);
    }
  }

  onNobleScanStart() {
    this.log.debug('On scanStart (this app or another app)');
    this.isActuallyScanning = true;
  }

  startScanning() {
    if (!this.peripheral && !this.isActuallyScanning) {
      this.log.info(`Start scanning for ${PERIPHERAL_NAME}...`);
      this.isScanning = true;
      noble.startScanning([], false);
    } else {
      this.log.debug('Already connected or scanning already actually started');
      // Do not call startScanning if scanning is actually started (may by other plugin)
      // Or we can stumble ourself, like interrupting the connection
    }
  }

  setDisconnectedAndStartScanning() {
    if (this.peripheral) {
      this.peripheral.once('disconnect', () => null);  // clear the disconnect handler
    }
    this.peripheral = null;
    this.startScanning();
  }

  onDiscoverPeripheral(peripheral: Peripheral) {
    // this.log.debug(`Discovered ${peripheral.advertisement.localName}`);

    if (!this.isScanning) {
      return;  // the other plugins may keep scanning, just ignore and do not interrupt
    }

    if (peripheral.advertisement.localName !== PERIPHERAL_NAME) {
      return;
    }
    this.log.info(`Found ${PERIPHERAL_NAME}`);

    // At this stage, we have the PERIPHERAL_NAME and the SERVICE_UUID matched.
    // Set this at early stage, to avoid re-discovering the peripheral and interfer each other
    this.isScanning = false;

    // Do not stop. If another plugin is using noble as well and acts on external stop (e.g. homebridge-mi-hygrothermograph),
    // this will interrupt the connect process and trigger livelock.
    // noble.stopScanning();

    peripheral.connect(error => {
      if (error) {
        this.log.error(`Failed to connect: ${error}`);
        this.setDisconnectedAndStartScanning();
      } else {
        this.log.info(`Connected to ${PERIPHERAL_NAME}`);
        this.peripheral = peripheral;
      }
    });
  }

  onPeripheralDisconnect() {
    this.log.info(`Disconnected from ${PERIPHERAL_NAME} peripheral. Restart scanning...`);
    this.setDisconnectedAndStartScanning();
  }

  public isConnectedToPeripheral(): boolean {
    return this.peripheral !== null;
  }

  public write(data: Buffer) {
    if (!this.peripheral) {
      this.log.warn(`Cannot write to ${PERIPHERAL_NAME}: not connected`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      // Should already be scanning, no need to restart
    }
    this.peripheral.writeHandle(HANDLE, data, false, () => null);
  }

  public sendCommand(command: string) {
    if (command.length > 18) {
      this.log.error(`Command too long: ${command}`);
    } else {
      const buffer = Buffer.from(command.padEnd(18, '*'));
      this.write(buffer);
    }
  }

  public turnOff() {
    this.sendCommand('#33        ');  // customized worldline 4
  }

  public worldlineMode(index: number, text: string) {
    if (!Number.isInteger(index) || index < 0 || index > 7) {
      this.log.error('Index must be an integer in the range of 0 to 7');
      return;
    }
    if (text.length !== 8) {
      this.log.error('Text must have length 8');
      return;
    }
    this.sendCommand('#3' + index.toString() + text);
  }

  public timeMode(mode: number) {
    if (mode === 0) {
      this.sendCommand('#410'); // HH MM SS
    } else if (mode === 1) {
      this.sendCommand('#411'); // 0.HHMMSS
    } else if (mode === 2) {
      this.sendCommand('#412'); // HHMMSS.MS
    }
    this.sendCommand('#430');
  }

  public gyroMode() {
    this.sendCommand('#422');
  }

  public randomMode(flashing: boolean) {
    if (flashing) {
      this.sendCommand('#4211');
    } else {
      this.sendCommand('#4210');
    }
  }

  public set12Or24H(use24H: boolean) {
    if (use24H) {
      this.sendCommand('#400');
    } else {
      this.sendCommand('#401');
    }
  }

  getFormattedTime(): string {
    const now = new Date();
    return now.toISOString().replace(/[-:.T]/g, '').substr(0, 14);
  }

  public syncTime() {
    this.sendCommand('#0' + this.getFormattedTime());
  }
}
