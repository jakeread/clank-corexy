#include <Arduino.h>
#include "indicators.h"

#include "drivers/step_a4950.h"
#include "axl/axl.h"
#include "axl/axl_config.h"
#include "utils_samd51/clock_utils.h"

#include "osape/core/osap.h"
#include "osape/core/ts.h"
#include "osape/vertices/endpoint.h"
#include "osape_arduino/vp_arduinoSerial.h"
#include "osape_ucbus/vb_ucBusDrop.h"

OSAP osap("axl-stepper_z");
// OSAP osap("axl-stepper_rl");
// OSAP osap("axl-stepper_rr");

// -------------------------------------------------------- 0: USB Serial 

VPort_ArduinoSerial vpUSBSerial(&osap, "arduinoUSBSerial", &Serial);

// -------------------------------------------------------- 1: Bus Drop 

VBus_UCBusDrop vbUCBusDrop(&osap, "ucBusDrop"); 

// -------------------------------------------------------- 2: AXL Settings

EP_ONDATA_RESPONSES onAXLSettingsData(uint8_t* data, uint16_t len){
  // jd, then pairs of accel & vel limits,
  axlSettings_t settings;
  uint16_t rptr = 0;
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    settings.accelLimits.axis[a] = ts_readFloat32(data, &rptr);
    settings.velocityLimits.axis[a] = ts_readFloat32(data, &rptr);
  }
  settings.queueStartDelayMS = ts_readUint32(data, &rptr);
  settings.ourActuatorID = ts_readUint8(data, &rptr);
  // ship em... 
  axl_setSettings(settings);
  // don't stash data, 
  return EP_ONDATA_ACCEPT;
}

Endpoint axlSettingsEP(&osap, "axlSettings", onAXLSettingsData);

// -------------------------------------------------------- 3: Axl Modal Requests 

EP_ONDATA_RESPONSES onStateData(uint8_t* data, uint16_t len){
  // check for partner-config badness, 
  if(len != AXL_NUM_DOF * 4 + 2){ OSAP::error("state req has bad DOF count"); return EP_ONDATA_REJECT; }
  // we have accel, rate, posn data, 
  vect_t targ;
  uint16_t rptr = 0;
  uint8_t mode = data[rptr ++];
  uint8_t set = data[rptr ++];
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    targ.axis[a] = ts_readFloat32(data, &rptr);
  }
  // set or target?
  if(set){
    switch(mode){
      case AXL_MODE_POSITION:
        if(axl_isMoving()){
          OSAP::error("AXL can't set pos while moving");
          break;
        }
        axl_setPosition(targ);
        break;
      default:
        OSAP::error("we can only 'set' position, others are targs");
        break;
    }
  } else {
    switch(mode){
      // case AXL_MODE_ACCEL:
      //   // axl_setAccelTarget(targ);
      //   break;
      case AXL_MODE_VELOCITY:
        axl_setVelocityTarget(targ);
        break;
      case AXL_MODE_POSITION:
        axl_setPositionTarget(targ);
        break;
      default:
        OSAP::error("AXL state targ has bad / unrecognized mode " + String(mode));
        break;
    }
  }
  // since we routinely update it w/ actual states (not requests) 
  return EP_ONDATA_REJECT;
}

uint8_t stateDataDummy[256];

boolean beforeAxlStateQuery(void);

Endpoint stateEP(&osap, "axlState", onStateData, beforeAxlStateQuery);

boolean beforeAxlStateQuery(void){
  uint16_t len = axl_getState(stateDataDummy);
  stateEP.write(stateDataDummy, len);
  return true;
}

// -------------------------------------------------------- 4: Axl Queue Addition 

EP_ONDATA_RESPONSES onSegmentData(uint8_t* data, uint16_t len){
  // careful, if you add a new field in axlPlannedSegment_t, recall you have to copy 
  // it manually into the buffer (!) 
  axlPlannedSegment_t segment;
  uint16_t rptr = 0;
  // location of segment-in-sequence, to count continuity, 
  segment.segmentNumber = ts_readUint32(data, &rptr);
  // which actuator is requested to ack this mfer, 
  segment.returnActuator = ts_readUint8(data, &rptr);
  // is it the end of this stream ?
  segment.isLastSegment = ts_readBoolean(data, &rptr);
  OSAP::debug("segnum, isLast " + String(segment.segmentNumber) + ", " + String(segment.isLastSegment));
  // unit vector describing segment's direction, 
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    segment.unitVector.axis[a] = ts_readFloat32(data, &rptr);
  }
  // start vel, accel-rate (up, and down), max velocity, final velocity, distance (all +ve)
  segment.vi = ts_readFloat32(data, &rptr);
  segment.accel = ts_readFloat32(data, &rptr);
  segment.vmax = ts_readFloat32(data, &rptr);
  segment.vf = ts_readFloat32(data, &rptr);
  segment.distance = ts_readFloat32(data, &rptr);
  // and send it... 
  axl_addSegmentToQueue(segment);
  // don't write to endpoint... 
  return EP_ONDATA_REJECT;
}

Endpoint precalculatedSegmentEP(&osap, "segmentsIn", onSegmentData);

// -------------------------------------------------------- 5: Halt Input 

EP_ONDATA_RESPONSES onHaltInData(uint8_t* data, uint16_t len){
  axl_halt(data[0]);
  return EP_ONDATA_REJECT;
}

Endpoint haltInEP(&osap, "haltIn", onHaltInData);

// -------------------------------------------------------- 6, 7, 8: Outputs

Endpoint haltOutEP(&osap, "haltOut");
Endpoint segmentAckOutEP(&osap, "segmentAckOut");
Endpoint segmentCompleteOutEP(&osap, "segmentCompleteOut");

// -------------------------------------------------------- 9: Motor Settings

uint8_t axisPick = 0;
boolean invert = false; 
uint16_t microstep = 4; 
float spu = 100.0F;
float cscale = 0.1F;

// aye, there should be a void onData overload... less confusing 
EP_ONDATA_RESPONSES onMotorSettingsData(uint8_t* data, uint16_t len){
  uint16_t rptr = 0;
  axisPick = data[rptr ++];
  ts_readBoolean(&invert, data, &rptr);
  ts_readUint16(&microstep, data, &rptr);
  spu = ts_readFloat32(data, &rptr);
  cscale = ts_readFloat32(data, &rptr);
  stepper_hw->setMicrostep(microstep);
  stepper_hw->setCurrent(cscale);
  stepper_hw->setInversion(invert);
  return EP_ONDATA_ACCEPT;
}

Endpoint motorSettingsEP(&osap, "motorSettings", onMotorSettingsData);

// -------------------------------------------------------- 10: Limit Halt-Output:

Endpoint limitHaltEP(&osap, "limitSwitchState");

#define LIMIT_PIN 23
#define LIMIT_PORT 0 

void limitSetup(void){
  PORT->Group[LIMIT_PORT].DIRCLR.reg = (1 << LIMIT_PIN);
  PORT->Group[LIMIT_PORT].PINCFG[LIMIT_PIN].bit.INEN = 1;
  // pullup 
  PORT->Group[LIMIT_PORT].OUTSET.reg = (1 << LIMIT_PIN);
}

boolean checkLimit(void){
  return (PORT->Group[LIMIT_PORT].IN.reg & (1 << LIMIT_PIN));
}

// -------------------------------------------------------- 11: Motion State 

boolean beforeMotionStateQuery(void);

Endpoint motionStateEP(&osap, "motionState", beforeMotionStateQuery);

uint8_t dummyMotionStateData[1];

boolean beforeMotionStateQuery(void){
  if(axl_isMoving()){
    dummyMotionStateData[0] = 1;
  } else {
    dummyMotionStateData[0] = 0;
  }
  motionStateEP.write(dummyMotionStateData, 1);
  return true;
}

// -------------------------------------------------------- Arduino Setup 

void setup() {
  CLKLIGHT_SETUP;
  ERRLIGHT_SETUP;
  DEBUG1PIN_SETUP;
  DEBUG2PIN_SETUP;
  // port begin 
  vpUSBSerial.begin();
  vbUCBusDrop.begin();
  // setup stepper machine 
  stepper_hw->init(false, 0.0F);
  stepper_hw->setMicrostep(4);
  // setup controller
  axl_setup();
  // setup limit swootch
  limitSetup();
  // ticker begin:
  // d51ClockUtils->start_ticker_a(AXL_TICKER_INTERVAL_US);
}

// -------------------------------------------------------- Das Loop 

uint32_t lastBlink = 0;
uint32_t blinkInterval = 50; // ms 

uint8_t axlData[256];
uint16_t axlDataLen = 0;

uint32_t lastLimitCheck = 0;
uint32_t limitCheckInterval = 1; // ms, helps to debounce, bummer to be running this often 
uint8_t limitTrace = 0; // 8-wide 1-bit state trace... for edge-masking, 
boolean limitState = false;
uint8_t dummy[2] = { 0, 0 }; // lol, typed endpoints wanted ! 

void loop() {
  osap.loop();
  // check for halt info... 
  axlDataLen = axl_getHaltPacket(axlData);
  if(axlDataLen){
    haltOutEP.write(axlData, axlDataLen);
  }
  // check for queueAck info... 
  axlDataLen = axl_getSegmentAckMsg(axlData);
  if(axlDataLen){
    segmentAckOutEP.write(axlData, axlDataLen);
  }
  // check for queueSegmentComplete 
  axlDataLen = axl_getSegmentCompleteMsg(axlData);
  if(axlDataLen){
    segmentCompleteOutEP.write(axlData, axlDataLen);
  }
  // refresh stepper hw, 
  stepper_hw->dacRefresh();
  if(lastBlink + blinkInterval < millis()){
    lastBlink = millis();
    CLKLIGHT_TOGGLE;
    // updateStatesEP();
    //axl_printHomeState();
  }
  // this, i.e, could be on an endpoint's loop code, non?
  if(lastLimitCheck + limitCheckInterval < millis()){
    lastLimitCheck = millis();
    // shift left one & tack bit on the end, 
    limitTrace = limitTrace << 1;
    limitTrace |= checkLimit() ? 1 : 0;
    // swap on positive or -ve edges, 
    if(limitTrace == 0b11111111 && limitState == false){
      ERRLIGHT_ON;
      limitState = true;
      dummy[0] = 1;
      limitHaltEP.write(dummy, 1);
    } else if (limitTrace == 0b00000000 && limitState == true){
      ERRLIGHT_OFF;
      limitState = false;
      dummy[0] = 0;
      limitHaltEP.write(dummy, 1);
    }
  }
  // if(errLightOn && errLightOnTime + 250 < millis()){
  //   ERRLIGHT_OFF;
  //   errLightOn = false;
  // }
}

// -------------------------------------------------------- Small-Time Ops 

volatile float stepRatchet = 0.0F;
void axl_onPositionDelta(uint8_t axis, float delta, float absolute){
  if(axis != axisPick) return;
  stepRatchet += delta * spu;
  if(stepRatchet >= 1.0F){
    stepper_hw->dir(true);
    stepper_hw->step();
    stepRatchet -= 1.0F;
  } else if (stepRatchet <= -1.0F){
    stepper_hw->dir(false);
    stepper_hw->step();
    stepRatchet += 1.0F;
  }
}

// void TC0_Handler(void){
//   DEBUG1PIN_ON;
//   TC0->COUNT32.INTFLAG.bit.MC0 = 1;
//   TC0->COUNT32.INTFLAG.bit.MC1 = 1;
//   // run the loop, 
//   axl_integrator();
//   DEBUG1PIN_OFF;
// }

void ucBusDrop_onRxISR(void){
  DEBUG1PIN_ON;
  axl_integrator();
  DEBUG1PIN_OFF;
}