export const PULSEGUARD_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
export const BPM_CHARACTERISTIC_UUID = "00002a37-0000-1000-8000-00805f9b34fb";
export const STRESS_CHARACTERISTIC_UUID = "00002a06-0000-1000-8000-00805f9b34fb";

type BluetoothValue = {
  buffer: ArrayBuffer;
  byteLength: number;
  byteOffset: number;
  getUint8(offset: number): number;
  getUint16(offset: number, littleEndian?: boolean): number;
  getInt16(offset: number, littleEndian?: boolean): number;
  getFloat32(offset: number, littleEndian?: boolean): number;
};

type BluetoothCharacteristic = {
  startNotifications(): Promise<BluetoothCharacteristic>;
  stopNotifications?(): Promise<BluetoothCharacteristic>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
  removeEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
  value?: BluetoothValue;
};

type BluetoothService = {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
};

type BluetoothServer = {
  connected: boolean;
  getPrimaryService(uuid: string): Promise<BluetoothService>;
};

type BluetoothDevice = {
  name?: string;
  id?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothServer>;
    disconnect(): void;
  };
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
  removeEventListener(type: "gattserverdisconnected", listener: () => void): void;
};

type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice(options: {
      filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
      optionalServices?: string[];
      acceptAllDevices?: boolean;
    }): Promise<BluetoothDevice>;
  };
};

export type PulseGuardSnapshot = {
  heartRate?: number;
  stress?: string;
  receivedAt?: number;
};

export type PulseGuardConnection = {
  name: string;
  id?: string;
  connectedAt: number;
  disconnect: () => void;
};

function valueFromEvent(event: Event): BluetoothValue | undefined {
  return (event.target as unknown as BluetoothCharacteristic | null)?.value;
}

export function supportsWebBluetooth(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as BluetoothNavigator).bluetooth);
}

/**
 * Connect to the PulseGuard ESP32 device running the MAX30105 and stress-level firmware.
 */
export async function connectPulseGuard(
  onSnapshot: (snapshot: PulseGuardSnapshot) => void,
  onDisconnect: () => void,
): Promise<PulseGuardConnection> {
  const bluetooth = (navigator as BluetoothNavigator).bluetooth;
  if (!bluetooth) {
    throw new Error(
      "Web Bluetooth is not available in this browser. Please use Google Chrome, Microsoft Edge, or a Web Bluetooth compatible browser over HTTPS.",
    );
  }

  let device: BluetoothDevice;
  try {
    device = await bluetooth.requestDevice({
      filters: [
        { name: "PulseGuard" },
        { namePrefix: "Pulse" },
        { services: [PULSEGUARD_SERVICE_UUID] },
      ],
      optionalServices: [PULSEGUARD_SERVICE_UUID],
    });
  } catch (error) {
    // Fallback allowing any device advertising the service or all BLE devices
    if ((error as Error).name === "NotFoundError" || (error as Error).message?.includes("cancelled")) {
      throw error;
    }
    device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [PULSEGUARD_SERVICE_UUID],
    });
  }

  if (!device.gatt) {
    throw new Error("The selected device does not expose a Bluetooth GATT server.");
  }

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(PULSEGUARD_SERVICE_UUID);

  const [bpmChar, stressChar] = await Promise.all([
    service.getCharacteristic(BPM_CHARACTERISTIC_UUID),
    service.getCharacteristic(STRESS_CHARACTERISTIC_UUID),
  ]);

  const textDecoder = new TextDecoder();

  const onBpmChanged = (event: Event) => {
    const value = valueFromEvent(event);
    if (!value || value.byteLength === 0) return;

    let hr = 0;
    if (value.byteLength >= 2) {
      // The ESP32 code writes `uint16_t bpmVal` (2 bytes little-endian).
      // Standard Bluetooth HRM profile uses flag byte at byte 0; here we handle both.
      const firstByte = value.getUint8(0);
      if (firstByte <= 1 && value.byteLength >= 2) {
        hr = (firstByte & 1) ? value.getUint16(1, true) : value.getUint8(1);
      } else {
        hr = value.getUint16(0, true);
      }
    } else {
      hr = value.getUint8(0);
    }

    if (hr >= 0 && hr <= 255) {
      onSnapshot({ heartRate: hr, receivedAt: Date.now() });
    }
  };

  const onStressChanged = (event: Event) => {
    const value = valueFromEvent(event);
    if (!value) return;
    try {
      const stressStr = textDecoder
        .decode(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
        .trim();
      if (stressStr) {
        onSnapshot({ stress: stressStr, receivedAt: Date.now() });
      }
    } catch {
      // Ignore decoding issues
    }
  };

  const disconnectedHandler = () => {
    onDisconnect();
  };

  bpmChar.addEventListener("characteristicvaluechanged", onBpmChanged);
  stressChar.addEventListener("characteristicvaluechanged", onStressChanged);
  device.addEventListener("gattserverdisconnected", disconnectedHandler);

  await Promise.all([
    bpmChar.startNotifications(),
    stressChar.startNotifications(),
  ]);

  return {
    name: device.name || "PulseGuard ESP32",
    id: device.id,
    connectedAt: Date.now(),
    disconnect: () => {
      try {
        bpmChar.removeEventListener("characteristicvaluechanged", onBpmChanged);
        stressChar.removeEventListener("characteristicvaluechanged", onStressChanged);
        device.removeEventListener("gattserverdisconnected", disconnectedHandler);
        if (device.gatt?.connected) {
          device.gatt.disconnect();
        }
      } catch {
        // Cleanup error safe
      }
    },
  };
}
