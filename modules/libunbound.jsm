/*
 * libunbound.jsm
 * 
 * Version: 1.0.0 (21 November 2013)
 * 
 * Copyright (c) 2013 Philippe Lieser
 * 
 * This software is licensed under the terms of the MIT License.
 * 
 * The above copyright and license notice shall be
 * included in all copies or substantial portions of the Software.
 */

// options for JSHint
/* jshint strict:true, moz:true */
/* jshint unused:true */ // allow unused parameters that are followed by a used parameter.
/* global Components, ctypes, OS, Services */
/* global ModuleGetter, Logging */
/* exported EXPORTED_SYMBOLS, libunbound */

var EXPORTED_SYMBOLS = [
	"libunbound"
];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://gre/modules/Services.jsm");

Cu.import("resource://dkim_verifier/ModuleGetter.jsm");
ModuleGetter.getosfile(this);

Cu.import("resource://dkim_verifier/logging.jsm");


const PREF_BRANCH = "extensions.dkim_verifier.dns.";


/**
 * @public
 */
var Constants = {
	RR_TYPE_A: 1,
	RR_TYPE_A6: 38,
	RR_TYPE_AAAA: 28,
	RR_TYPE_AFSDB: 18,
	RR_TYPE_ANY: 255,
	RR_TYPE_APL: 42,
	RR_TYPE_ATMA: 34,
	RR_TYPE_AXFR: 252,
	RR_TYPE_CERT: 37,
	RR_TYPE_CNAME: 5,
	RR_TYPE_DHCID: 49,
	RR_TYPE_DLV: 32769,
	RR_TYPE_DNAME: 39,
	RR_TYPE_DNSKEY: 48,
	RR_TYPE_DS: 43,
	RR_TYPE_EID: 31,
	RR_TYPE_GID: 102,
	RR_TYPE_GPOS: 27,
	RR_TYPE_HINFO: 13,
	RR_TYPE_IPSECKEY: 45,
	RR_TYPE_ISDN: 20,
	RR_TYPE_IXFR: 251,
	RR_TYPE_KEY: 25,
	RR_TYPE_KX: 36,
	RR_TYPE_LOC: 29,
	RR_TYPE_MAILA: 254,
	RR_TYPE_MAILB: 253,
	RR_TYPE_MB: 7,
	RR_TYPE_MD: 3,
	RR_TYPE_MF: 4,
	RR_TYPE_MG: 8,
	RR_TYPE_MINFO: 14,
	RR_TYPE_MR: 9,
	RR_TYPE_MX: 15,
	RR_TYPE_NAPTR: 35,
	RR_TYPE_NIMLOC: 32,
	RR_TYPE_NS: 2,
	RR_TYPE_NSAP: 22,
	RR_TYPE_NSAP_PTR: 23,
	RR_TYPE_NSEC: 47,
	RR_TYPE_NSEC3: 50,
	RR_TYPE_NSEC3PARAMS: 51,
	RR_TYPE_NULL: 10,
	RR_TYPE_NXT: 30,
	RR_TYPE_OPT: 41,
	RR_TYPE_PTR: 12,
	RR_TYPE_PX: 26,
	RR_TYPE_RP: 17,
	RR_TYPE_RRSIG: 46,
	RR_TYPE_RT: 21,
	RR_TYPE_SIG: 24,
	RR_TYPE_SINK: 40,
	RR_TYPE_SOA: 6,
	RR_TYPE_SRV: 33,
	RR_TYPE_SSHFP: 44,
	RR_TYPE_TSIG: 250,
	RR_TYPE_TXT: 16,
	RR_TYPE_UID: 101,
	RR_TYPE_UINFO: 100,
	RR_TYPE_UNSPEC: 103,
	RR_TYPE_WKS: 11,
	RR_TYPE_X25: 19,
};

var prefs = Services.prefs.getBranch(PREF_BRANCH);
var log = Logging.getLogger("libunbound");

var lib;
var ctx = ctypes.voidptr_t();
// http://unbound.net/documentation/libunbound.html
var ub_ctx;
var ub_result;
var ub_ctx_create;
var ub_ctx_delete;
var ub_ctx_config;
var ub_ctx_set_fwd;
var ub_ctx_resolvconf;
var ub_ctx_add_ta;
var ub_ctx_debuglevel;
var ub_resolve;
var ub_resolve_free;
var ub_strerror;

let libunbound = {
	/**
	 * The result of the query.
	 * Does differ from the original ub_result a bit.
	 * 
	 * @typedef {Object} ub_result
	 * @property {String} qname
	 *           text string, original question
	 * @property {Number} qtype
	 *           type code asked for
	 * @property {Number} qclass
	 *           class code (CLASS IN (internet))
	 * @property {Object[]} data
	 *           Array of converted rdata items. Empty for unsupported RR types.
	 *           Currently supported types: TXT
	 * @property {Number[][]} data_raw
	 *           Array of rdata items as byte array
	 * @property {String} canonname
	 *           canonical name of result
	 * @property {Number} rcode
	 *           additional error code in case of no data
	 * @property {Boolean} havedata
	 *           true if there is data
	 * @property {Boolean} nxdomain
	 *           true if nodata because name does not exist
	 * @property {Boolean} secure
	 *           true if result is secure.
	 * @property {Boolean} bogus
	 *           true if a security failure happened.
	 * @property {String} why_bogus
	 *           string with error if bogus
	 * @property {Number} ttl
	 *           number of seconds the result is valid
	 */

	/**
	 * Perform resolution of the target name.
	 * 
	 * @param {String} name
	 * @param {Number} [rrtype=libunbound.Constants.RR_TYPE_A]
	 * 
	 * @return {ub_result}
	 */
	resolve: function libunbound_resolve(name, rrtype=Constants.RR_TYPE_A) {
		"use strict";

		let _result = ub_result.ptr();
		let retval;

		// query for name
		retval = ub_resolve(ctx, name, 
			rrtype, 
			1 /* CLASS IN (internet) */, _result.address()
		);
		if (retval !== 0) {
			log.debug("resolve error: "+ub_strerror(retval).readString()+"\n");
			return null;
		}

		// array of converted rdata
		let data = [];
		// array of rdata as byte array
		let data_raw = [];
		if(_result.contents.havedata) {
			// get data
			let lenPtr = _result.contents.len;
			let dataPtr=_result.contents.data;
			while (!dataPtr.contents.isNull()) {
				// get rdata as byte array
				let tmp = ctypes.cast(dataPtr.contents,
					ctypes.uint8_t.array(lenPtr.contents).ptr
				).contents;
				let rdata = new Array(tmp.length);
				for (let i = 0; i < tmp.length; i++) {
					rdata[i] = tmp[i];
				}
				data_raw.push(rdata);

				// convert rdata for known RR types
				switch (rrtype) {
					case Constants.RR_TYPE_TXT:
						// http://tools.ietf.org/html/rfc1035#page-20
						let str = "";
						let i=0;
						let j;
						// read all <character-string>s
						while (i < rdata.length) {
							// get length of current <character-string>
							j = rdata[i];
							i += 1;
							// read current <character-string>
							str += String.fromCharCode.apply(null, rdata.slice(i, i+j));
							i += j;
						}
						data.push(str);
						break;
				}
				
				dataPtr = dataPtr.increment();
				lenPtr = lenPtr.increment();
			}

			log.debug("data: "+data);
		}

		let result = {};
		if (!_result.contents.qname.isNull()) {
			result.qname = _result.contents.qname.readString();
		}
		result.qtype = _result.contents.qtype;
		result.qclass = _result.contents.qclass;
		result.data = data;
		result.data_raw = data_raw;
		if (!_result.contents.canonname.isNull()) {
			result.canonname = _result.contents.canonname.readString();
		}
		result.rcode = _result.contents.rcode;
		result.havedata = _result.contents.havedata === 1;
		result.nxdomain = _result.contents.nxdomain === 1;
		result.secure = _result.contents.secure === 1;
		result.bogus = _result.contents.bogus === 1;
		if (!_result.contents.why_bogus.isNull()) {
			result.why_bogus = _result.contents.why_bogus.readString();
		}
		result.ttl = _result.contents.ttl;
		
		log.debug("qname: "+result.qname+", qtype: "+result.qtype+", rcode: "+result.rcode+", secure: "+result.secure+", bogus: "+result.bogus+", why_bogus: "+result.why_bogus);
		
		ub_resolve_free(_result);
		
		return result;
	},
};

/**
 * init
 */
function init() {
	"use strict";

	let path;
	if (prefs.getBoolPref("libunbound.path.relToProfileDir")) {
		path = OS.Path.join(OS.Constants.Path.profileDir,
			prefs.getCharPref("libunbound.path"));
	} else {
		path = prefs.getCharPref("libunbound.path");
	}
	lib = ctypes.open(path);
	
	ub_ctx = new ctypes.StructType("ub_ctx");
	// struct ub_result {
		// char* qname; /* text string, original question */
		// int qtype;   /* type code asked for */
		// int qclass;  /* class code asked for */
		// char** data; /* array of rdata items, NULL terminated*/
		// int* len;    /* array with lengths of rdata items */
		// char* canonname; /* canonical name of result */
		// int rcode;   /* additional error code in case of no data */
		// void* answer_packet; /* full network format answer packet */
		// int answer_len; /* length of packet in octets */
		// int havedata; /* true if there is data */
		// int nxdomain; /* true if nodata because name does not exist */
		// int secure;  /* true if result is secure */
		// int bogus;   /* true if a security failure happened */
		// char* why_bogus; /* string with error if bogus */
		// int ttl;     /* number of seconds the result is valid */
	// };
	ub_result = new ctypes.StructType("ub_result", [
		{ "qname": ctypes.char.ptr },
		{ "qtype": ctypes.int },
		{ "qclass": ctypes.int },
		{ "data": ctypes.char.ptr.ptr },
		{ "len": ctypes.int.ptr },
		{ "canonname": ctypes.char.ptr },
		{ "rcode": ctypes.int },
		{ "answer_packet": ctypes.voidptr_t },
		{ "answer_len": ctypes.int },
		{ "havedata": ctypes.int },
		{ "nxdomain": ctypes.int },
		{ "secure": ctypes.int },
		{ "bogus": ctypes.int },
		{ "why_bogus": ctypes.char.ptr },
		{ "ttl": ctypes.int } 
	]);
	
	// struct ub_ctx * ub_ctx_create(void);
	ub_ctx_create = lib.declare("ub_ctx_create", ctypes.default_abi, ub_ctx.ptr);
	
	// void ub_ctx_delete(struct ub_ctx* ctx);
	ub_ctx_delete = lib.declare("ub_ctx_delete", ctypes.default_abi, ctypes.void_t,
		ub_ctx.ptr);
	
	// int ub_ctx_config(struct ub_ctx* ctx, char* fname);
	ub_ctx_config = lib.declare("ub_ctx_config", ctypes.default_abi, ctypes.int,
		ub_ctx.ptr, ctypes.char.ptr);
	
	//int ub_ctx_set_fwd(struct ub_ctx* ctx, char* addr);
	ub_ctx_set_fwd = lib.declare("ub_ctx_set_fwd", ctypes.default_abi, ctypes.int,
		ub_ctx.ptr, ctypes.char.ptr);
	
	// int ub_ctx_resolvconf(struct ub_ctx* ctx, char* fname);
	ub_ctx_resolvconf = lib.declare("ub_ctx_resolvconf", ctypes.default_abi, ctypes.int,
		ub_ctx.ptr, ctypes.char.ptr);
	
	// int ub_ctx_add_ta(struct ub_ctx* ctx, char* ta);
	ub_ctx_add_ta = lib.declare("ub_ctx_add_ta", ctypes.default_abi, ctypes.int,
		ub_ctx.ptr, ctypes.char.ptr);
	
	// int ub_ctx_debuglevel(struct ub_ctx* ctx, int d);
	ub_ctx_debuglevel = lib.declare("ub_ctx_debuglevel", ctypes.default_abi, ctypes.int,
		ub_ctx.ptr, ctypes.int);
	
	// int ub_resolve(struct ub_ctx* ctx, char* name,
                  // int rrtype, int rrclass, struct ub_result** result);
	ub_resolve = lib.declare("ub_resolve", ctypes.default_abi, ctypes.int,
		ub_ctx.ptr, ctypes.char.ptr, ctypes.int, ctypes.int, ub_result.ptr.ptr);
	
	// void ub_resolve_free(struct ub_result* result);
	ub_resolve_free = lib.declare("ub_resolve_free", ctypes.default_abi, ctypes.void_t,
		ub_result.ptr);
	
	// const char * ub_strerror(int err);
	ub_strerror = lib.declare("ub_strerror", ctypes.default_abi, ctypes.char.ptr,
		ctypes.int);
	
	update_ctx();

	log.debug("initialized");
}

/**
 * updates ctx by deleting old an creating new
 */
function update_ctx() {
	"use strict";
	
	let retval;

	if (!ctx.isNull()) {
		// delete old context
		ub_ctx_delete(ctx);
		ctx = ctypes.voidptr_t();
	}

	// create context
	ctx = ub_ctx_create();
	if(ctx.isNull()) {
		log.fatal("error: could not create unbound context\n");
		return;
	}
	
	// read config file if specified
	if (prefs.getPrefType("libunbound.conf") === prefs.PREF_STRING) {
		if((retval=ub_ctx_config(ctx, prefs.getCharPref("libunbound.conf"))) !== 0) {
			log.error("error in ub_ctx_config: "+ub_strerror(retval).readString()+
				". errno: "+ctypes.errno+"\n");
		}
	}

	// set debuglevel if specified
	if (prefs.getPrefType("libunbound.debuglevel") === prefs.PREF_INT) {
		if((retval=ub_ctx_debuglevel(ctx, prefs.getIntPref("libunbound.debuglevel"))) !== 0) {
			log.error("error in ub_ctx_debuglevel: "+ub_strerror(retval).readString()+
				". errno: "+ctypes.errno+"\n");
		}
	}
	
	// get DNS servers form OS
	if (prefs.getBoolPref("getNameserversFromOS")) {
		if((retval=ub_ctx_resolvconf(ctx, null)) !== 0) {
			log.error("error in ub_ctx_resolvconf: "+ub_strerror(retval).readString()+
				". errno: "+ctypes.errno+"\n");
		}
	}
	
	// set additional DNS servers
	let nameservers = prefs.getCharPref("nameserver").split(";");
	nameservers.forEach(function(element /*, index, array*/) {
		if (element.trim() !== "") {
			if((retval=ub_ctx_set_fwd(ctx, element.trim())) !== 0) {
				log.error("error in ub_ctx_set_fwd: "+ub_strerror(retval).readString()+
					". errno: "+ctypes.errno+"\n");
			}
		}
	});
	
	// add root trust anchor
	if((retval=ub_ctx_add_ta(ctx, prefs.getCharPref("dnssec.trustAnchor"))) !== 0) {
		log.error("error in ub_ctx_add_ta: "+ub_strerror(retval).readString()+
			". errno: "+ctypes.errno+"\n");
	}
}

libunbound.Constants = Constants;

init();
