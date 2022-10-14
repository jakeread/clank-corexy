#include <Arduino.h>

#include "indicators.h"
#include "utils_samd51/clock_utils.h"

#include "osape/core/osap.h"
#include "osape/vertices/endpoint.h"

#include "osape_arduino/vp_arduinoSerial.h"

#include "osape_ucbus/vb_ucBusHead.h"

// -------------------------------------------------------- OSAP ENDPOINTS SETUP

OSAP osap("motion-head");

VPort_ArduinoSerial vpUSBSer(&osap, "arduinoUSBSerial", &Serial);   // 0

VBus_UCBusHead vbUCBusHead(&osap, "ucBusHead");                     // 1

// -------------------------------------------------------- POWER MODES 

// 5v bus hi-side sw on PB23
#define V5BUS_ON PIN_HI(1, 23)
#define V5BUS_OFF PIN_LO(1, 23)
#define V5BUS_SETUP PIN_SETUP_OUTPUT(1, 23); PIN_LO(1, 23)

#define V24BUS_ON PIN_HI(1, 14)
#define V24BUS_OFF PIN_LO(1, 14)
#define V24BUS_SETUP PIN_SETUP_OUTPUT(1, 14); PIN_LO(1, 14)

#define V5POGO_ON PIN_HI(1, 22)
#define V5POGO_OFF PIN_LO(1, 22)
#define V5POGO_SETUP PIN_SETUP_OUTPUT(1, 22); PIN_LO(1, 22)

#define V24POGO_ON PIN_HI(1, 17)
#define V24POGO_OFF PIN_LO(1, 17)
#define V24POGO_SETUP PIN_SETUP_OUTPUT(1, 17); PIN_LO(1, 17)

// track states 
boolean state5V = false;
boolean state24V = false;

void publishPowerStates(void);

// make changes 
void powerStateUpdate(boolean st5V, boolean st24V, boolean st5VPogo, boolean st24VPogo){
  // guard against bad state
  if(st24V && !st5V) st24V = false;
  // check order-of-flip... if 5v is turning off, we will turn 24v first, 
  // in all other scenarios, we flip 5v first 
  if(state5V && !st5V){
    state24V = st24V; state5V = st5V;
    // publish, 24v first, and allow charge to leave... 
    state24V ? V24_ON : V24_OFF;
    delay(50);
    state5V ? V5_ON : V5_OFF;
  } else {
    state24V = st24V; state5V = st5V;
    // publish, 5v first, and allow some bring-up... 
    state5V ? V5_ON : V5_OFF;
    delay(10);
    state24V ? V24_ON : V24_OFF;
  }
  // now ... would like to write to the endpoint 
  publishPowerStates();
}

EP_ONDATA_RESPONSES onPowerData(uint8_t* data, uint16_t len){
  // read requested states out 
  boolean st5V, st24V;
  uint16_t rptr = 0;
  ts_readBoolean(&st5V, data, &rptr);
  ts_readBoolean(&st24V, data, &rptr);
  // run the update against our statemachine 
  powerStateUpdate(st5V, st24V);
  // here's a case where we'll never want to let senders to 
  // update our internal state, so we just return 
  return EP_ONDATA_REJECT;
  // this means that the endpoint's data store will remain unchanged (from the write) 
  // but remains true to what was written in when we updated w/ the powerStateUpdate fn... 
}

Endpoint powerEp(&osap, "powerSwitches", onPowerData);      // 6: Power Switches 

void publishPowerStates(void){
  uint8_t powerData[2];
  uint16_t wptr = 0;
  ts_writeBoolean(state5V, powerData, &wptr);
  ts_writeBoolean(state24V, powerData, &wptr);
  powerEp.write(powerData, 2);
}

// -------------------------------------------------------- 8: Precalcd-move-adder / producer 

// Endpoint precalculatedMoveEP(&osap, "precalculatedMoveOutput");

// -------------------------------------------------------- SETUP 

void setup() {
  ERRLIGHT_SETUP;
  CLKLIGHT_SETUP;
  DEBUG1PIN_SETUP;
  DEBUG2PIN_SETUP;
  DEBUG3PIN_SETUP;
  DEBUG4PIN_SETUP;
  // setup the power stuff 
  V5BUS_SETUP;
  V24BUS_SETUP;
  V5POGO_SETUP;
  V24POGO_SETUP;
  // write states, all off until told otherwise, 
  powerStateUpdate(false, false, false, false);
  // osap
  vpUSBSer.begin();
  vbUCBusHead.begin();
  // startup axl, 
  // axl_setup(); 
  // bus runs on 10kHz ticker 
  d51ClockUtils->start_ticker_a(1000000/10000); 
  // turn 5v on by default,  
  powerStateUpdate(true, true);
}

unsigned long epUpdateInterval = 250; // ms 
unsigned long lastUpdate = 0;
uint16_t moveDataLen = 0;
uint8_t moveBuffer[128];

void loop() {
  // main recursive osap loop:
  osap.loop();
} // end loop 

// runs on period defined by timer_a setup: 
volatile uint32_t timeTick = 0;
volatile uint64_t timeBlink = 0;

void TC0_Handler(void){
  // runs at period established above... 
  TC0->COUNT32.INTFLAG.bit.MC0 = 1;
  TC0->COUNT32.INTFLAG.bit.MC1 = 1;
  // do bus action first: want downstream clocks to be deterministic-ish
  vbUCBusHead.timerISR();
  // do blinking, lol
  timeBlink ++;
  if(timeBlink > 500){
    DEBUG1PIN_TOGGLE;
    timeBlink = 0; 
  }
}