var express = require('express');
var router = express.Router();
var fs = require('fs');


var pid = new pidjs(2000, 44, 165, 4);



var act_temp = 0;
var set_point = 0;
var state = false;
var re = 'YES\n[^=]*=([0-9]*)';

var temp_avg = [];
var pos = 0;
var max = 10;

var cycle_time = 2000;
var relay_on = false;

var pid_interval = setInterval(update_pid, cycle_time);
var read_interval = setInterval(update_temp, 1000);

function addTemp(temp) {
    temp_avg[pos++] = temp;
    if (pos >= max) {
        pos = 0;
    }
}

function getonoff(cycle_time, duty_cycle) {
    var duty = duty_cycle / 100.0;
    var on_time = cycle_time * (duty);
    return on_time;
}

fs.readFile("logs/state.dat", function(err, data) {
    if (err) return;
    var stateObj = JSON.parse(data + "");
    set_point = stateObj["set_point"];
    state = stateObj["state"];
});



function update_temp() {
    fs.readFile('/sys/bus/w1/devices/28-0000059873b0/w1_slave', function (err, data) {
        if (err) {
            return console.log("Failed to read temp" + err);
        }
        var match = ("" + data).match(re);
        if (match) {
            var ctemp = match[1];
            var ftemp = (ctemp / 1000) * 9 / 5 + 32;
            act_temp = ftemp;
        }
    });

    if (state) {
        var time = new Date().getTime();
        var line = JSON.stringify({'act_temp': act_temp, 'relay_state': (relay_on ? "ON" : "OFF"), 'set_point': set_point, 'time': time}) + ",\n";
        fs.appendFile("logs/temps.log", line, function (err) {
            if (err)console.log(err);
        });
    }
}

function update_pid() {
    var duty_cycle = pid.calcPID_reg4(act_temp, set_point, state);

    if (duty_cycle == 0) {
        set_relay(false);
    } else if (duty_cycle == 100) {
        set_relay(true);
    } else {
        var on_off = getonoff(cycle_time, duty_cycle);
        set_relay(true);
        sleep(on_off);
        set_relay(false);
    }
}

function sleep(milliseconds) {
    var start = new Date().getTime();
    for (var i = 0; i < 1e7; i++) {
        if ((new Date().getTime() - start) > milliseconds){
            break;
        }
    }
}


function set_relay(on) {
    var enable = on ? 1:0;
    relay_on = on;
    //console.log("Writing " + state + " to gpio25");
    fs.writeFile("/sys/devices/virtual/gpio/gpio25/value", enable, function (err) {

    });
}



/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'Express' });
});

/* GET Hello World page. */
router.get('/set_temp', function(req, res) {
    set_point = req.query.temp;
    state = req.query.state == 'on';
    var state_string = JSON.stringify({'state':state,'set_point':set_point});
    fs.writeFile("logs/state.dat", state_string, function (err) {
        if (res){
            res.json({'failed':true, 'error':err, 'state':state});
        } else {
            //console.log("{'failed':" + (err ? true:false) + ", 'error':" + (err ? err: "") + ", 'state':"+state+"}");
        }
    });
    res.render('index', { title: 'Hello, World!', 'temp':set_point, 'state':state });
});

router.get('/relay_change', function (req, res) {
    var enable = req.query.state == 0;
    set_relay(enable);
});


module.exports = router;



function pidjs(ts, kc, ti, td){
    this.ek_1 = 0.0;  // e[k-1] = SP[k-1] - PV[k-1] = Tset_hlt[k-1] - Thlt[k-1]
    this.ek_2 = 0.0;  // e[k-2] = SP[k-2] - PV[k-2] = Tset_hlt[k-2] - Thlt[k-2]
    this.xk_1 = 0.0;  // PV[k-1] = Thlt[k-1]
    this.xk_2 = 0.0;  // PV[k-2] = Thlt[k-1]
    this.yk_1 = 0.0;  // y[k-1] = Gamma[k-1]
    this.yk_2 = 0.0;  // y[k-2] = Gamma[k-1]
    this.lpf_1 = 0.0; // lpf[k-1] = LPF output[k-1]
    this.lpf_2 = 0.0; // lpf[k-2] = LPF output[k-2]

    this.yk = 0.0; // output

    this.GMA_HLIM = 100.0;
    this.GMA_LLIM = 0.0;

    this.kc = kc;
    this.ti = ti;
    this.td = td;
    this.ts = ts;
    this.k_lpf = 0.0;
    this.k0 = 0.0;
    this.k1 = 0.0;
    this.k2 = 0.0;
    this.k3 = 0.0;
    this.lpf1 = 0.0;
    this.lpf2 = 0.0;
    this.ts_ticks = 0;
    this.pid_model = 3;
    this.pp = 0.0;
    this.pi = 0.0;
    this.pd = 0.0;
    if (this.ti == 0.0){
        this.k0 = 0.0;
    } else {
        this.k0 = this.kc * this.ts / this.ti;
    }
    this.k1 = this.kc * this.td / this.ts;
    this.lpf1 = (2.0 * this.k_lpf - this.ts) / (2.0 * this.k_lpf + this.ts);
    this.lpf2 = this.ts / (2.0 * this.k_lpf + this.ts);
}

pidjs.prototype.calcPID_reg3 = function(xk, tset, enable){
    ek = 0.0;
    lpf = 0.0;
    ek = tset - xk; // calculate e[k] = SP[k] - PV[k]
    //--------------------------------------
    // Calculate Lowpass Filter for D-term
    //--------------------------------------
    lpf = this.lpf1 * this.lpf_1 + this.lpf2 * (ek + this.ek_1);

    if (enable){
        //-----------------------------------------------------------
        // Calculate PID controller:
        // y[k] = y[k-1] + kc*(e[k] - e[k-1] +
        // Ts*e[k]/Ti +
        // Td/Ts*(lpf[k] - 2*lpf[k-1] + lpf[k-2]))
        //-----------------------------------------------------------
        this.pp = this.kc * (ek - this.ek_1); // y[k] = y[k-1] + Kc*(PV[k-1] - PV[k])
        this.pi = this.k0 * ek;  // + Kc*Ts/Ti * e[k]
        this.pd = this.k1 * (lpf - 2.0 * this.lpf_1 + this.lpf_2);
        this.yk += this.pp + this.pi + this.pd;
    } else {
        this.yk = 0.0;
        this.pp = 0.0;
        this.pi = 0.0;
        this.pd = 0.0;
    }
    this.ek_1 = this.ek; // e[k-1] = e[k]
    this.lpf_2 = this.lpf_1; // update stores for LPF
    this.lpf_1 = this.lpf;

    // limit y[k] to GMA_HLIM and GMA_LLIM
    if (this.yk > this.GMA_HLIM){
        this.yk = this.GMA_HLIM;
    }
    if (this.yk < this.GMA_LLIM){
        this.yk = this.GMA_LLIM;
    }
    return this.yk;
};

pidjs.prototype.calcPID_reg4 = function(xk, tset, enable){
    ek = 0.0;
    ek = tset - xk; // calculate e[k] = SP[k] - PV[k]

    if (enable){
        //-----------------------------------------------------------
        // Calculate PID controller:
        // y[k] = y[k-1] + kc*(PV[k-1] - PV[k] +
        // Ts*e[k]/Ti +
        // Td/Ts*(2*PV[k-1] - PV[k] - PV[k-2]))
        //-----------------------------------------------------------
        this.pp = this.kc * (this.xk_1 - xk); // y[k] = y[k-1] + Kc*(PV[k-1] - PV[k])
        this.pi = this.k0 * ek;  // + Kc*Ts/Ti * e[k]
        this.pd = this.k1 * (2.0 * this.xk_1 - xk - this.xk_2);
        this.yk += this.pp + this.pi + this.pd;
    } else {
        this.yk = 0.0;
        this.pp = 0.0;
        this.pi = 0.0;
        this.pd = 0.0;
    }
    this.xk_2 = this.xk_1;  // PV[k-2] = PV[k-1]
    this.xk_1 = xk;    // PV[k-1] = PV[k]

    // limit y[k] to GMA_HLIM and GMA_LLIM
    if (this.yk > this.GMA_HLIM){
        this.yk = this.GMA_HLIM;
    }
    if (this.yk < this.GMA_LLIM){
        this.yk = this.GMA_LLIM;
    }

    return this.yk;
};


