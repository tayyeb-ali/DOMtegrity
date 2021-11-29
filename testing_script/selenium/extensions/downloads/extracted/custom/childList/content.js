	var dclhandler = false;

	if (document.readyState !== 'loading') {
		init_all();
	} else {
		dclhandler = true;
		document.addEventListener('DOMContentLoaded', init_all);
	}

	function init_all(){
		createHeading();
	}

	function createHeading() {
        var h1 = document.createElement('h1');
        h1.textContent = "New Heading!!!";
        document.body.appendChild(h1);
	}
