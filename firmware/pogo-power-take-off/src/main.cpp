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
#define SW_5V_BUS_ON PIN_HI(1, 23)
#define SW_5V_BUS_OFF PIN_LO(1, 23)
#define SW_5V_BUS_SETUP PIN_SETUP_OUTPUT(1, 23); PIN_LO(1, 23)

#define SW_24V_BUS_ON PIN_HI(1, 14)
#define SW_24V_BUS_OFF PIN_LO(1, 14)
#define SW_24V_BUS_SETUP PIN_SETUP_OUTPUT(1, 14); PIN_LO(1, 14)

#define SW_5V_POGO_ON PIN_HI(1, 22)
#define SW_5V_POGO_OFF PIN_LO(1, 22)
#define SW_5V_POGO_SETUP PIN_SETUP_OUTPUT(1, 22); PIN_LO(1, 22)

#define SW_24V_POGO_ON PIN_HI(1, 17)
#define SW_24V_POGO_OFF PIN_LO(1, 17)
#define SW_24V_POGO_SETUP PIN_SETUP_OUTPUT(1, 17); PIN_LO(1, 17)

// we'll use this to write to the endpoint... 
void publishPowerStates(boolean stBus5V, boolean stBus24V, boolean stPogo5V, boolean stPogo24V);

// make changes 
void powerStateUpdate(boolean stBus5V, boolean stBus24V, boolean stPogo5V, boolean stPogo24V){
  // guard against bad states, 
  if(stBus24V && !stBus5V) stBus24V = false;
  if(stPogo24V && !stPogo5V) stPogo24V = false;
  // if either 24v needs to turn off, do that now: 
  if(!stBus24V) SW_24V_BUS_OFF;
  if(!stPogo24V) SW_24V_POGO_OFF;
  // a delay for charges to bleed... maybe unneccessary, or better done with a proper async wait 
  delay(50);
  // set 5v next in either dir, 
  stBus5V ? SW_5V_BUS_ON : SW_5V_BUS_OFF;
  stPogo5V ? SW_5V_POGO_ON : SW_5V_POGO_OFF;
  // and 24v powering up, 
  if(stBus24V) SW_24V_BUS_ON;
  if(stPogo24V) SW_24V_POGO_ON;
  // now ... would like to write to the endpoint 
  publishPowerStates(stBus5V, stBus24V, stPogo5V, stPogo24V);
}

EP_ONDATA_RESPONSES onPowerData(uint8_t* data, uint16_t len){
  // read requested states out 
  boolean stBus5V, stBus24V, stPogo5V, stPogo24V;
  uint16_t rptr = 0;
  ts_readBoolean(&stBus5V, data, &rptr);
  ts_readBoolean(&stBus24V, data, &rptr);
  ts_readBoolean(&stPogo5V, data, &rptr);
  ts_readBoolean(&stPogo24V, data, &rptr);
  // run the update against our statemachine 
  powerStateUpdate(stBus5V, stBus24V, stPogo5V, stPogo24V);
  // here's a case where we'll never want to let senders to 
  // update our internal state, so we just return 
  return EP_ONDATA_REJECT;
  // this means that the endpoint's data store will remain unchanged (from the write) 
  // but remains true to what was written in when we updated w/ the powerStateUpdate fn... 
}

Endpoint powerEp(&osap, "powerSwitches", onPowerData);      // 6: Power Switches 

void publishPowerStates(boolean stBus5V, boolean stBus24V, boolean stPogo5V, boolean stPogo24V){
  uint8_t powerData[4];
  uint16_t wptr = 0;
  ts_writeBoolean(stBus5V, powerData, &wptr);
  ts_writeBoolean(stBus24V, powerData, &wptr);
  ts_writeBoolean(stPogo5V, powerData, &wptr);
  ts_writeBoolean(stPogo24V, powerData, &wptr);
  powerEp.write(powerData, wptr);
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
  SW_5V_BUS_SETUP;
  SW_24V_BUS_SETUP;
  SW_5V_POGO_SETUP;
  SW_24V_POGO_SETUP;
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
  powerStateUpdate(false, false, false, false);
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